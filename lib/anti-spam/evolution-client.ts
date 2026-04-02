/**
 * Cliente Evolution API para o módulo Anti-Spam.
 * Remove participante do grupo e (opcional) deleta mensagem.
 * Rate limit: 1 ação/segundo por instância. Retry: 3 tentativas com backoff.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { maybeMarkEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';
import { toWaJid } from '@/lib/utils/phone-utils';

const FETCH_TIMEOUT_MS = 25_000;
const SCAN_FETCH_TIMEOUT_MS = 10_000; // timeout menor para leituras de scan
const RATE_LIMIT_MS = 1000; // 1 por segundo por instância
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

/** Último uso por instance_id para rate limit */
const lastCallByInstance = new Map<string, number>();

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

export interface InstanceCredentials {
  instanceName: string;
  baseUrl: string;
  apikey: string;
}

/**
 * Resolve baseUrl e apikey a partir de evolution_instances + evolution_apis.
 */
export async function getInstanceCredentials(instanceId: string): Promise<InstanceCredentials | null> {
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis!inner (
        id,
        base_url,
        api_key_global
      )
    `)
    .eq('id', instanceId)
    .single();

  if (error || !instance) return null;

  const api = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
  const baseUrl = api?.base_url;
  const apikey = instance.apikey || api?.api_key_global;
  if (!baseUrl || !apikey) return null;

  return {
    instanceName: instance.instance_name,
    baseUrl,
    apikey,
  };
}

function waitRateLimit(instanceId: string): Promise<void> {
  const last = lastCallByInstance.get(instanceId) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed >= RATE_LIMIT_MS) {
    lastCallByInstance.set(instanceId, now);
    return Promise.resolve();
  }
  const wait = RATE_LIMIT_MS - elapsed;
  lastCallByInstance.set(instanceId, now + wait);
  return new Promise((r) => setTimeout(r, wait));
}

export interface RemoveParticipantResult {
  success: boolean;
  error?: string;
  httpStatus?: number;
}

/** Participante enriquecido retornado pela Evolution API V2 */
export interface ParticipantInfo {
  /** Número do telefone (somente dígitos, ex.: 558195561309) */
  phone: string;
  /** Nome do contato, se disponível */
  name: string | null;
  /** Admin do grupo: null | 'admin' | 'superadmin' */
  admin: string | null;
}

export interface GetGroupParticipantsResult {
  success: boolean;
  participants?: ParticipantInfo[];
  error?: string;
  httpStatus?: number;
}

export interface FetchAllGroupsResult {
  success: boolean;
  /** mapa de groupJid → lista de participantes */
  groupMap?: Map<string, ParticipantInfo[]>;
  /** mapa de groupJid → mensagem de erro (grupos que falharam individualmente) */
  errorMap?: Map<string, string>;
  error?: string;
  httpStatus?: number;
}

/**
 * Helper interno: busca participantes de um grupo usando credenciais já resolvidas.
 * Extrai phoneNumber (sem @s.whatsapp.net) e name de cada participante.
 * Evita N+1 queries ao Supabase quando chamado em loop.
 */
async function _fetchGroupParticipants(
  creds: InstanceCredentials,
  groupJid: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<{ participants?: ParticipantInfo[]; error?: string }> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/participants/${creds.instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: { apikey: creds.apikey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { error: text || `HTTP ${response.status}` };
    }

    if (!response.ok) {
      return { error: data?.message || data?.error || `HTTP ${response.status}` };
    }

    const raw: any[] = Array.isArray(data?.participants) ? data.participants : [];
    const participants = raw
      .map((p: any): ParticipantInfo | null => {
        // phoneNumber é o campo confiável da V2: "558195561309@s.whatsapp.net"
        // id pode ser um @lid (ID interno do WhatsApp), não é um número de telefone
        const rawPhone =
          p?.phoneNumber ??
          (typeof p?.id === 'string' && !String(p.id).includes('@lid') ? p.id : null) ??
          p?.jid ??
          (typeof p === 'string' ? p : null);
        if (!rawPhone) return null;
        const phone = String(rawPhone).replace(/@.*$/, '').replace(/\D/g, '').trim();
        if (!phone) return null;
        return {
          phone,
          name: p?.name ? String(p.name).trim() || null : null,
          admin: p?.admin ? String(p.admin) : null,
        };
      })
      .filter(Boolean) as ParticipantInfo[];

    return { participants };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

/**
 * Evolution API V2: busca participantes de um grupo.
 * GET /group/participants/{instance}?groupJid=...
 * Doc: https://doc.evolution-api.com/v2/api-reference/group-controller/find-participants
 */
export async function getGroupParticipantsV2(
  instanceId: string,
  groupJid: string
): Promise<GetGroupParticipantsResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  const result = await _fetchGroupParticipants(creds, groupJid);
  if (result.error !== undefined) {
    await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, result.error, 'anti-spam/participants');
    return { success: false, error: result.error };
  }
  return { success: true, participants: result.participants ?? [] };
}

/**
 * Busca participantes dos grupos: usa Evolution API V2 GET /group/participants/{instance}
 * quando groupJids é informado; caso contrário tenta fetchAllGroups?getParticipants=true (legado).
 * @param instanceId - ID da instância
 * @param groupJids - opcional: lista de JIDs dos grupos; quando passado, usa endpoint V2 por grupo
 */
export async function fetchAllGroupsWithParticipants(
  instanceId: string,
  groupJids?: string[]
): Promise<FetchAllGroupsResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  const markIfDropped = (err: string | undefined) =>
    maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, err, 'anti-spam/fetchGroups');

  // Evolution API V2: participantes vêm do GET /group/participants por grupo (uma chamada por grupo)
  if (groupJids && groupJids.length > 0) {
    const groupMap = new Map<string, ParticipantInfo[]>();
    const errorMap = new Map<string, string>();
    const startMs = Date.now();
    for (const groupJid of groupJids) {
      await waitRateLimit(instanceId);
      // Usa helper interno: credenciais já resolvidas, sem N+1 queries ao Supabase
      const result = await _fetchGroupParticipants(creds, groupJid, SCAN_FETCH_TIMEOUT_MS);
      if (result.participants !== undefined) {
        groupMap.set(groupJid, [...result.participants]);
      } else if (result.error) {
        await markIfDropped(result.error);
        errorMap.set(groupJid, result.error);
      }
    }
    const durationMs = Date.now() - startMs;
    console.log('[evolution-client] fetchParticipants V2', {
      instance: creds.instanceName,
      groups_requested: groupJids.length,
      groups_ok: groupMap.size,
      groups_error: errorMap.size > 0 ? errorMap.size : undefined,
      duration_ms: durationMs,
    });
    return { success: true, groupMap, errorMap };
  }

  // Fallback legado: fetchAllGroups (V2 pode não retornar participants no body)
  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/fetchAllGroups/${creds.instanceName}?getParticipants=true`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: { apikey: creds.apikey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      const errLine = text || `HTTP ${response.status}`;
      await markIfDropped(errLine);
      return { success: false, error: errLine, httpStatus: response.status };
    }

    if (!response.ok) {
      const errLine = String(data?.message || data?.error || `HTTP ${response.status}`);
      await markIfDropped(errLine);
      return {
        success: false,
        error: errLine,
        httpStatus: response.status,
      };
    }

    const allGroups: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.groups)
        ? data.groups
        : Array.isArray(data?.data)
          ? data.data
          : [];

    const groupMap = new Map<string, ParticipantInfo[]>();
    for (const g of allGroups) {
      const gId: string = g?.id ?? g?.remoteJid ?? '';
      if (!gId) continue;
      const raw: any[] = Array.isArray(g.participants) ? g.participants : [];
      const participants = raw
        .map((p: any): ParticipantInfo | null => {
          const rawPhone =
            p?.phoneNumber ??
            (typeof p?.id === 'string' && !String(p.id).includes('@lid') ? p.id : null) ??
            p?.jid ??
            (typeof p === 'string' ? p : null);
          if (!rawPhone) return null;
          const phone = String(rawPhone).replace(/@.*$/, '').replace(/\D/g, '').trim();
          if (!phone) return null;
          return {
            phone,
            name: p?.name ? String(p.name).trim() || null : null,
            admin: p?.admin ? String(p.admin) : null,
          };
        })
        .filter(Boolean) as ParticipantInfo[];
      groupMap.set(gId, participants);
    }

    return { success: true, groupMap };
  } catch (err: any) {
    const errLine = err?.message || String(err);
    await markIfDropped(errLine);
    return { success: false, error: errLine };
  }
}

/**
 * Lista participantes de um grupo via Evolution API V2.
 * GET /group/participants/{instance}?groupJid=...
 */
export async function getGroupParticipants(
  instanceId: string,
  groupJid: string
): Promise<GetGroupParticipantsResult> {
  return getGroupParticipantsV2(instanceId, groupJid);
}

/**
 * Remove participante do grupo via Evolution API.
 * participantJidOrPhone: JID (5531999887766@s.whatsapp.net) ou número (31999887766).
 */
export async function removeParticipant(
  instanceId: string,
  groupJid: string,
  participantJidOrPhone: string
): Promise<RemoveParticipantResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  await waitRateLimit(instanceId);

  const participantJid = participantJidOrPhone.includes('@')
    ? participantJidOrPhone
    : toWaJid(participantJidOrPhone);

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  // groupJid como query param — padrão desta versão da Evolution API
  const url = `${baseUrl}/group/updateParticipant/${creds.instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  const body = { action: 'remove', participants: [participantJid] };

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apikey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (response.ok) {
        return { success: true, httpStatus: response.status };
      }

      lastError = data?.message || data?.error || `HTTP ${response.status}`;
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/removeParticipant');
        return { success: false, error: lastError, httpStatus: response.status };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/removeParticipant');
        return { success: false, error: lastError };
      }
    }
  }

  await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/removeParticipant');
  return { success: false, error: lastError || 'Unknown error' };
}

export interface DeleteMessageKey {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

export interface DeleteMessageResult {
  success: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Deleta mensagem para todos (opcional).
 * key: { remoteJid, id, fromMe } do payload da mensagem.
 */
export async function deleteMessageForEveryone(
  instanceId: string,
  key: DeleteMessageKey
): Promise<DeleteMessageResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  await waitRateLimit(instanceId);

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  // Endpoint comum em Evolution API v1/v2
  const url = `${baseUrl}/chat/sendMessage/${creds.instanceName}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  // Payload para "delete message for everyone" (varia por versão da API)
  const body = {
    deleteMessage: {
      remoteJid: key.remoteJid,
      id: key.id,
      fromMe: key.fromMe,
    },
  };

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apikey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (response.ok) {
        return { success: true, httpStatus: response.status };
      }

      lastError = data?.message || data?.error || `HTTP ${response.status}`;
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/deleteMessage');
        return { success: false, error: lastError, httpStatus: response.status };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/deleteMessage');
        return { success: false, error: lastError };
      }
    }
  }

  await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instanceId, lastError, 'anti-spam/deleteMessage');
  return { success: false, error: lastError || 'Unknown error' };
}
