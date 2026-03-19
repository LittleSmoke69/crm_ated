/**
 * Sincroniza diretório de chats/contatos da Evolution API para `chat_conversations`.
 * Usa POST /chat/findChats e POST /chat/findContacts (Evolution API v2).
 * Não substitui last_message_at / preview existentes por dados mais fracos vindos da API.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

const EVOLUTION_FETCH_TIMEOUT_MS = 90_000;
const SYNC_COOLDOWN_MS = 45_000;

const lastSyncAtByInstanceId = new Map<string, number>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function unwrapEvolutionArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');
  }
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    const keys = ['chats', 'data', 'contacts', 'records'] as const;
    for (const k of keys) {
      const arr = o[k];
      if (Array.isArray(arr)) {
        return arr.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');
      }
    }
  }
  return [];
}

function pickRemoteJid(entry: Record<string, unknown>): string | null {
  const candidates = [entry.remoteJid, entry.remote_jid, entry.id, entry.jid];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('@') && !c.includes('@broadcast')) {
      return c.trim();
    }
  }
  return null;
}

function pickTitle(entry: Record<string, unknown>, remoteJid: string): string {
  const from =
    entry.pushName ??
    entry.name ??
    entry.subject ??
    entry.notify ??
    entry.verifiedName;
  if (typeof from === 'string' && from.trim()) return from.trim();
  const local = remoteJid.split('@')[0] || remoteJid;
  return local;
}

function pickLastMessageAtIso(entry: Record<string, unknown>): string | null {
  const lm = entry.lastMessage;
  if (lm && typeof lm === 'object') {
    const ts = (lm as Record<string, unknown>).messageTimestamp ?? (lm as Record<string, unknown>).timestamp;
    if (typeof ts === 'number' && ts > 0) {
      return new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
    }
  }
  const u = entry.updatedAt ?? entry.updated_at ?? entry.conversationTimestamp;
  if (typeof u === 'number' && u > 0) {
    return new Date(u > 1e12 ? u : u * 1000).toISOString();
  }
  if (typeof u === 'string' && u.trim()) {
    const d = new Date(u);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function pickPreview(entry: Record<string, unknown>): string | null {
  const lm = entry.lastMessage;
  if (lm && typeof lm === 'object') {
    const m = (lm as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (m && typeof m === 'object') {
      const text =
        (m.conversation as string) ||
        ((m.extendedTextMessage as Record<string, unknown>)?.text as string) ||
        ((m.imageMessage as Record<string, unknown>)?.caption as string);
      if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 100);
    }
  }
  return null;
}

async function evolutionPostJson(
  baseUrl: string,
  apikey: string,
  pathSegment: string,
  body: unknown
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = `${normalizeBaseUrl(baseUrl)}${pathSegment}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EVOLUTION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey,
      },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timeoutId);
  }
}

export type EvolutionDirectorySyncResult = {
  upserted: number;
  skippedCooldown: boolean;
  findChatsStatus?: number;
  findContactsStatus?: number;
  error?: string;
};

/**
 * Chama a Evolution API e grava/atualiza linhas em chat_conversations para a instância.
 */
export async function syncEvolutionDirectoryToChatConversations(params: {
  instanceId: string;
  instanceName: string;
  baseUrl: string;
  apikey: string;
  workspaceId: string | null;
  instanceOwnerUserId: string | null;
  force?: boolean;
}): Promise<EvolutionDirectorySyncResult> {
  const { instanceId, instanceName, baseUrl, apikey, workspaceId, instanceOwnerUserId, force } = params;

  const now = Date.now();
  if (!force) {
    const last = lastSyncAtByInstanceId.get(instanceId) ?? 0;
    if (now - last < SYNC_COOLDOWN_MS) {
      return { upserted: 0, skippedCooldown: true };
    }
  }

  const enc = encodeURIComponent(instanceName);
  const findChatsRes = await evolutionPostJson(baseUrl, apikey, `/chat/findChats/${enc}`, {});
  const findContactsRes = await evolutionPostJson(baseUrl, apikey, `/chat/findContacts/${enc}`, {
    where: {},
  });

  const rowsFromChats = findChatsRes.ok ? unwrapEvolutionArray(findChatsRes.json) : [];
  const rowsFromContacts = findContactsRes.ok ? unwrapEvolutionArray(findContactsRes.json) : [];

  if (!findChatsRes.ok && !findContactsRes.ok) {
    const hint =
      (findChatsRes.text && findChatsRes.text.slice(0, 200)) ||
      (findContactsRes.text && findContactsRes.text.slice(0, 200));
    return {
      upserted: 0,
      skippedCooldown: false,
      findChatsStatus: findChatsRes.status,
      findContactsStatus: findContactsRes.status,
      error: `Evolution API: findChats ${findChatsRes.status}, findContacts ${findContactsRes.status}${hint ? ` — ${hint}` : ''}`,
    };
  }

  lastSyncAtByInstanceId.set(instanceId, Date.now());

  const merged = new Map<string, Record<string, unknown>>();
  for (const row of rowsFromContacts) {
    const jid = pickRemoteJid(row);
    if (jid) merged.set(jid, row);
  }
  for (const row of rowsFromChats) {
    const jid = pickRemoteJid(row);
    if (!jid) continue;
    const prev = merged.get(jid);
    merged.set(jid, prev ? { ...prev, ...row } : row);
  }

  const { data: existingRows, error: existingErr } = await supabaseServiceRole
    .from('chat_conversations')
    .select('id, remote_jid, last_message_at, title, last_message_preview')
    .eq('instance_id', instanceId);

  if (existingErr) {
    return {
      upserted: 0,
      skippedCooldown: false,
      findChatsStatus: findChatsRes.status,
      findContactsStatus: findContactsRes.status,
      error: `Erro ao ler conversas locais: ${existingErr.message}`,
    };
  }

  const existingByJid = new Map(
    (existingRows ?? []).map((r) => [r.remote_jid as string, r as { id: string; last_message_at?: string | null; title?: string | null; last_message_preview?: string | null }])
  );

  let upserted = 0;

  for (const [remoteJid, entry] of merged) {
    if (remoteJid.includes('status@broadcast')) continue;

    const title = pickTitle(entry, remoteJid);
    const isGroup = remoteJid.endsWith('@g.us');
    const fromEvolution = pickLastMessageAtIso(entry);
    const preview = pickPreview(entry);
    const prev = existingByJid.get(remoteJid);

    if (!prev) {
      await chatService.upsertConversation({
        instance_id: instanceId,
        workspace_id: workspaceId ?? undefined,
        user_id: instanceOwnerUserId ?? undefined,
        remote_jid: remoteJid,
        title,
        is_group: isGroup,
        last_message_at: fromEvolution ?? new Date().toISOString(),
        last_message_preview: preview ?? undefined,
      });
      upserted += 1;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (title && title !== prev.title) {
      updates.title = title;
    }
    if (fromEvolution) {
      const prevTs = prev.last_message_at ? new Date(prev.last_message_at).getTime() : 0;
      const evoTs = new Date(fromEvolution).getTime();
      if (evoTs > prevTs) {
        updates.last_message_at = fromEvolution;
        if (preview) updates.last_message_preview = preview;
      }
    }
    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabaseServiceRole
        .from('chat_conversations')
        .update(updates)
        .eq('id', prev.id);
      if (!upErr) upserted += 1;
    }
  }

  return {
    upserted,
    skippedCooldown: false,
    findChatsStatus: findChatsRes.status,
    findContactsStatus: findContactsRes.status,
  };
}
