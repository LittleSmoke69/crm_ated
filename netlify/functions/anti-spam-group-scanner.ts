/**
 * Netlify Scheduled Function: anti-spam-group-scanner
 *
 * Cron: a cada 1 minuto (configurado no netlify.toml)
 * Escaneia todos os grupos das configs ativas, remove blacklist e internacionais.
 * Salva logs em anti_spam_scan_jobs para controle via admin.
 * Processa em lotes de 5 grupos: retorna parcial conforme avança.
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { normalizeToE164BR } from '../../lib/utils/phone-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function supabase() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Configurações ─────────────────────────────────────────────────────────
const RATE_LIMIT_MS = 1000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const SCAN_BATCH_SIZE = 5;
const FETCH_TIMEOUT_MS = 25000;

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

async function getInstanceCredentials(instanceId: string) {
  const { data: row } = await supabase()
    .from('evolution_instances')
    .select('id, instance_name, apikey, evolution_apis(id, base_url, api_key_global)')
    .eq('id', instanceId)
    .single();

  if (!row) return null;
  const api = Array.isArray(row.evolution_apis) ? row.evolution_apis[0] : row.evolution_apis;
  const baseUrl = api?.base_url;
  const apikey = row.apikey || api?.api_key_global;
  if (!baseUrl || !apikey) return null;
  return { instanceName: row.instance_name, baseUrl, apikey };
}

async function waitRateLimit(instanceId: string, lastCall: Map<string, number>) {
  const last = lastCall.get(instanceId) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed >= RATE_LIMIT_MS) { lastCall.set(instanceId, now); return; }
  const wait = RATE_LIMIT_MS - elapsed;
  lastCall.set(instanceId, now + wait);
  await new Promise(r => setTimeout(r, wait));
}

async function removeParticipant(instanceId: string, groupJid: string, participantJidOrPhone: string, lastCall: Map<string, number>) {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) return { success: false, error: 'Instância sem credenciais' };

  await waitRateLimit(instanceId, lastCall);

  const participantJid = participantJidOrPhone.includes('@')
    ? participantJidOrPhone
    : `${participantJidOrPhone.replace(/\D/g, '')}@s.whatsapp.net`;

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/updateParticipant/${creds.instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
  const body = { action: 'remove', participants: [participantJid] };

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
      if (response.ok) return { success: true };

      const text = await response.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { message: text }; }
      const errMsg = data?.message || data?.error || `HTTP ${response.status}`;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt - 1)));
      } else {
        return { success: false, error: errMsg };
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt - 1)));
      } else {
        return { success: false, error: errMsg };
      }
    }
  }
  return { success: false, error: 'Unknown error' };
}

async function fetchAllGroups(instanceId: string) {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) return { success: false, groupNames: [] as Array<{ group_jid: string; group_name: string | null }> };

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/fetchAllGroups/${creds.instanceName}?getParticipants=false`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(finalUrl, {
      method: 'GET', headers: { apikey: creds.apikey }, signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { return { success: false, groupNames: [] }; }
    if (!response.ok) return { success: false, groupNames: [] };

    const arr: any[] = Array.isArray(data) ? data : data?.data ?? data?.groups ?? [];
    const groupNames = arr
      .map((g: any) => ({ group_jid: g?.id ?? g?.remoteJid ?? '', group_name: g?.subject ?? null }))
      .filter((g: any) => g.group_jid);

    return { success: true, groupNames };
  } catch {
    return { success: false, groupNames: [] };
  }
}

async function getGroupParticipantsV2(instanceId: string, groupJid: string) {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) return { success: false, participants: [] as Array<{ phone: string }> };

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/participants/${creds.instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(finalUrl, {
      method: 'GET', headers: { apikey: creds.apikey }, signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { return { success: false, participants: [] }; }
    if (!response.ok) return { success: false, participants: [] };

    const raw: any[] = Array.isArray(data?.participants)
      ? data.participants
      : Array.isArray(data)
        ? data
        : [];
    const participants = raw
      .map((p: any) => {
        const rawPhone =
          p?.phoneNumber ??
          (typeof p?.id === 'string' && !String(p.id).includes('@lid') ? p.id : null) ??
          p?.jid ??
          (typeof p === 'string' ? p : null);
        if (!rawPhone) return null;
        const phone = String(rawPhone).replace(/@.*$/, '').replace(/\D/g, '').trim();
        if (!phone) return null;
        return { phone };
      })
      .filter((entry): entry is { phone: string } => entry != null);

    return { success: true, participants };
  } catch {
    return { success: false, participants: [] };
  }
}

async function recordAction(configId: string, bancaId: string | null, userId: string | null, groupJid: string, phoneE164: string, action: string, result: string, error: string | null, reason: string) {
  await supabase().from('anti_spam_actions').insert({
    config_id: configId, banca_id: bancaId, user_id: userId,
    event_id: null, group_jid: groupJid, phone_e164: phoneE164,
    action, result, error_message: error,
    meta: { source: 'group_scanner', reason },
  });
}

async function recordScanLog(configId: string, ownerId: string | null, status: string, resultJson: any, error: string | null) {
  if (!ownerId) return;
  await supabase().from('anti_spam_scan_jobs').insert({
    config_id: configId, owner_id: ownerId, status, result: resultJson, error,
  });
}

interface AntiSpamConfig {
  id: string;
  banca_id: string | null;
  owner_type: string;
  owner_id: string | null;
  is_enabled: boolean;
  master_instance_id: string;
  watcher_instance_id: string | null;
  scan_mode?: string;
}

async function loadActiveConfigs(): Promise<AntiSpamConfig[]> {
  const { data } = await supabase()
    .from('anti_spam_configs')
    .select('id, banca_id, owner_type, owner_id, is_enabled, master_instance_id, watcher_instance_id, scan_mode')
    .eq('is_enabled', true);
  return (data ?? []) as AntiSpamConfig[];
}

async function getConfigGroups(config: AntiSpamConfig) {
  if (config.scan_mode === 'all_groups' || !config.scan_mode) {
    const result = await fetchAllGroups(config.master_instance_id);
    if (!result.success) {
      console.error(`[Scanner] Config ${config.id}: fetchAllGroups falhou — instância sem resposta ou desconectada`);
      return [];
    }
    if (result.groupNames.length === 0) {
      console.warn(`[Scanner] Config ${config.id}: fetchAllGroups retornou 0 grupos`);
      return [];
    }
    return result.groupNames.map((g: any) => ({ groupJid: g.group_jid, groupName: g.group_name || g.group_jid }));
  }

  // scan_mode === 'selected_groups'
  const { data } = await supabase()
    .from('anti_spam_groups')
    .select('group_jid, group_name')
    .eq('config_id', config.id)
    .eq('is_monitored', true);
  if (!data?.length) return [];
  return data.map((g: any) => ({ groupJid: g.group_jid, groupName: g.group_name || g.group_jid }));
}

async function scanGroup(config: AntiSpamConfig, groupJid: string, groupName: string, blacklist: Set<string>, lastCall: Map<string, number>) {
  const groupResult: any = {
    group_jid: groupJid,
    group_name: groupName,
    participants_total: 0,
    removed: [] as Array<{ phone_e164: string; reason: string; success: boolean; error?: string }>,
    errors: [] as string[],
  };

  const result = await getGroupParticipantsV2(config.master_instance_id, groupJid);
  if (!result.success) {
    groupResult.errors.push('Erro ao buscar participantes');
    return groupResult;
  }

  groupResult.participants_total = result.participants.length;

  for (const p of result.participants) {
    const raw = p.phone || '';
    if (!raw) continue;

    const phoneE164 = normalizeToE164BR(raw);

    if (!phoneE164) {
      // internacional / inválido
      const rawDigits = raw.replace(/\D/g, '');
      if (rawDigits.length >= 8) {
        const normal = rawDigits.startsWith('55') ? '+' + rawDigits : '+55' + rawDigits;
        const removeResult = await removeParticipant(config.master_instance_id, groupJid, raw, lastCall);
        groupResult.removed.push({ phone_e164: normal, reason: 'invalid_number', success: removeResult.success, error: removeResult.error });
        await recordAction(config.id, config.banca_id, config.owner_id, groupJid, normal, 'scan_remove_invalid', removeResult.success ? 'success' : 'fail', removeResult.error ?? null, 'invalid_number');
      }
      continue;
    }

    if (blacklist.has(phoneE164)) {
      const removeResult = await removeParticipant(config.master_instance_id, groupJid, phoneE164, lastCall);
      groupResult.removed.push({ phone_e164: phoneE164, reason: 'blacklist', success: removeResult.success, error: removeResult.error });
      await recordAction(config.id, config.banca_id, config.owner_id, groupJid, phoneE164, 'scan_remove_blacklist', removeResult.success ? 'success' : 'fail', removeResult.error ?? null, 'blacklist');
    }
  }

  return groupResult;
}

export const handler: Handler = async () => {
  try {
    const configs = await loadActiveConfigs();
    if (configs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, configs_scanned: 0, message: 'Nenhuma config ativa' }) };
    }

    const cacheByConfig = new Map<string, Set<string>>();
    for (const config of configs) {
      const { data } = await supabase()
        .from('anti_spam_blacklist')
        .select('phone_e164')
        .eq('config_id', config.id)
        .eq('status', 'active');
      cacheByConfig.set(config.id, new Set((data ?? []).map((r: any) => r.phone_e164)));
    }

    let grandTotalRemoved = 0;
    let grandTotalErrors = 0;
    let grandTotalGroups = 0;
    const lastCallMap = new Map<string, number>();

    for (const config of configs) {
      const groups = await getConfigGroups(config);
      if (groups.length === 0) continue;

      const blacklist = cacheByConfig.get(config.id) ?? new Set<string>();
      const ownerKey = config.owner_id || config.banca_id;

      grandTotalGroups += groups.length;
      console.log(`[Scanner] Config ${config.id}: ${groups.length} grupos encontrados, ${blacklist.size} na blacklist`);

      for (let i = 0; i < groups.length; i += SCAN_BATCH_SIZE) {
        const batch = groups.slice(i, i + SCAN_BATCH_SIZE);
        const batchResults: any[] = [];
        let batchRemoved = 0;
        let batchErrors = 0;

        for (const g of batch) {
          const groupResult = await scanGroup(config, g.groupJid, g.groupName, blacklist, lastCallMap);
          batchResults.push(groupResult);
          batchRemoved += groupResult.removed.filter((r: any) => r.success).length;
          batchErrors += groupResult.errors.length;
        }

        await recordScanLog(
          config.id, ownerKey,
          batchErrors > 0 ? 'partial' : 'completed',
          { batch_range: `${i + 1}-${i + batch.length}`, total_groups: batch.length, total_removed: batchRemoved, total_errors: batchErrors, groups: batchResults },
          batchErrors > 0 ? batchResults.flatMap((r) => r.errors).join(' | ') : null
        );

        console.log(`[Scanner] Config ${config.id}: batch ${Math.floor(i / SCAN_BATCH_SIZE) + 1}/${Math.ceil(groups.length / SCAN_BATCH_SIZE)}, ${batch.length} grupos, ${batchRemoved} removidos, ${batchErrors} erros`);
        grandTotalRemoved += batchRemoved;
        grandTotalErrors += batchErrors;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        configs_scanned: configs.length,
        total_groups: grandTotalGroups,
        total_removed: grandTotalRemoved,
        total_errors: grandTotalErrors,
      }),
    };
  } catch (err: any) {
    console.error('[anti-spam-group-scanner] Erro:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message || 'Erro no scanner' }) };
  }
};
