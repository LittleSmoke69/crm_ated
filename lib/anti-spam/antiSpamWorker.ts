/**
 * Worker Anti-Spam em tempo real.
 * Lê eventos de evolution_webhook_events (cursor por banca), processa e executa ações.
 * Idempotente; suporta polling com intervalo configurável.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { extractPhones, normalizeToE164BR, toWaJid } from '@/lib/utils/phone-utils';
import { removeParticipant } from './evolution-client';
import type { AntiSpamConfig, WebhookEventRow } from './types';

const POLL_INTERVAL_MS = Number(process.env.ANTI_SPAM_POLL_MS) || 800;
const BATCH_SIZE = Number(process.env.ANTI_SPAM_BATCH_SIZE) || 50;
const EVENT_TYPES_PARTICIPANTS = ['group-participants.update', 'group.update', 'GROUP_PARTICIPANTS_UPDATE'];
const EVENT_TYPES_MESSAGES = ['messages.upsert', 'MESSAGES_UPSERT'];

function normalizeEventType(t: string): string {
  return String(t || '').toLowerCase().replace(/_/g, '.');
}

/**
 * Carrega configs ativas com nomes das instâncias (master e watcher).
 */
async function loadActiveConfigs(): Promise<AntiSpamConfig[]> {
  const { data: configs, error } = await supabaseServiceRole
    .from('anti_spam_configs')
    .select(`
      id,
      banca_id,
      is_enabled,
      master_instance_id,
      watcher_instance_id,
      denuncia_group_jid,
      scan_mode
    `)
    .eq('is_enabled', true);

  if (error || !configs?.length) return [];

  const instanceIds = new Set<string>();
  configs.forEach((c: any) => {
    if (c.master_instance_id) instanceIds.add(c.master_instance_id);
    if (c.watcher_instance_id) instanceIds.add(c.watcher_instance_id);
  });

  const { data: instances } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name')
    .in('id', Array.from(instanceIds));

  const nameById = new Map<string, string>();
  instances?.forEach((i: any) => nameById.set(i.id, i.instance_name));

  return configs.map((c: any) => ({
    ...c,
    master_instance_name: nameById.get(c.master_instance_id),
    watcher_instance_name: c.watcher_instance_id ? nameById.get(c.watcher_instance_id) : null,
  }));
}

/**
 * Agrupa configs por banca_id e retorna mapa banca_id -> { instanceNames, configs }.
 */
function groupConfigsByBanca(configs: AntiSpamConfig[]): Map<string, { instanceNames: Set<string>; configs: AntiSpamConfig[] }> {
  const byBanca = new Map<string, { instanceNames: Set<string>; configs: AntiSpamConfig[] }>();
  for (const c of configs) {
    let entry = byBanca.get(c.banca_id);
    if (!entry) {
      entry = { instanceNames: new Set(), configs: [] };
      byBanca.set(c.banca_id, entry);
    }
    entry.configs.push(c);
    if (c.master_instance_name) entry.instanceNames.add(c.master_instance_name);
    if (c.watcher_instance_name) entry.instanceNames.add(c.watcher_instance_name);
  }
  return byBanca;
}

/**
 * Obtém ou cria cursor para uma banca.
 */
async function getCursor(bancaId: string): Promise<{ last_event_id: string | null; last_received_at: string | null }> {
  const { data, error } = await supabaseServiceRole
    .from('anti_spam_event_cursor')
    .select('last_event_id, last_received_at')
    .eq('banca_id', bancaId)
    .single();

  if (error || !data) return { last_event_id: null, last_received_at: null };
  return { last_event_id: data.last_event_id, last_received_at: data.last_received_at };
}

/**
 * Busca próximos eventos para uma banca (instance_name IN ... e (received_at, id) > cursor).
 */
async function fetchNextEvents(
  _bancaId: string,
  instanceNames: string[],
  cursor: { last_event_id: string | null; last_received_at: string | null }
): Promise<WebhookEventRow[]> {
  if (instanceNames.length === 0) return [];

  let query = supabaseServiceRole
    .from('evolution_webhook_events')
    .select('id, received_at, env, event_type, instance_name, remote_jid, message_id, payload, payload_normalized')
    .in('instance_name', instanceNames)
    .eq('env', 'prod')
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH_SIZE + 50);

  if (cursor.last_received_at) {
    query = query.gte('received_at', cursor.last_received_at);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[AntiSpam] Erro ao buscar eventos:', error.message);
    return [];
  }
  const rows = (data || []) as WebhookEventRow[];
  if (!cursor.last_event_id || !cursor.last_received_at) {
    return rows.slice(0, BATCH_SIZE);
  }
  const after = rows.filter(
    (r) =>
      r.received_at > cursor.last_received_at! ||
      (r.received_at === cursor.last_received_at && r.id > cursor.last_event_id!)
  );
  return after.slice(0, BATCH_SIZE);
}

/**
 * Atualiza cursor após processar lote.
 */
async function updateCursor(bancaId: string, lastEvent: { id: string; received_at: string }): Promise<void> {
  const { error } = await supabaseServiceRole.from('anti_spam_event_cursor').upsert(
    {
      banca_id: bancaId,
      last_event_id: lastEvent.id,
      last_received_at: lastEvent.received_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'banca_id' }
  );
  if (error) console.error('[AntiSpam] Erro ao atualizar cursor:', error.message);
}

/**
 * Verifica se já existe ação idêntica (idempotência).
 */
async function actionAlreadyDone(
  configId: string,
  eventId: string,
  action: string,
  groupJid: string | null,
  phoneE164: string | null
): Promise<boolean> {
  const key = `${eventId}:${action}:${groupJid ?? ''}:${phoneE164 ?? ''}`;
  const { data, error } = await supabaseServiceRole
    .from('anti_spam_actions')
    .select('id, meta')
    .eq('config_id', configId)
    .eq('event_id', eventId)
    .eq('action', action)
    .in('result', ['success', 'skipped'])
    .limit(20);

  if (error || !data?.length) return false;
  const hasKey = data.some((r: any) => r.meta?.action_key === key);
  return hasKey;
}

/**
 * Registra ação em anti_spam_actions.
 */
async function recordAction(
  configId: string,
  bancaId: string,
  eventId: string,
  groupJid: string | null,
  phoneE164: string | null,
  action: string,
  result: 'success' | 'fail' | 'skipped',
  errorMessage?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  const actionKey = `${eventId}:${action}:${groupJid ?? ''}:${phoneE164 ?? ''}`;
  await supabaseServiceRole.from('anti_spam_actions').insert({
    config_id: configId,
    banca_id: bancaId,
    event_id: eventId,
    group_jid: groupJid,
    phone_e164: phoneE164,
    action,
    result,
    error_message: errorMessage ?? null,
    meta: { ...meta, action_key: actionKey },
  });
}

/**
 * Retorna config que usa essa instance_name como master ou watcher.
 */
function getConfigForInstance(configs: AntiSpamConfig[], instanceName: string): AntiSpamConfig | null {
  return configs.find(
    (c) => c.master_instance_name === instanceName || c.watcher_instance_name === instanceName
  ) ?? null;
}

/**
 * Verifica se número está na blacklist ativa.
 */
async function isInBlacklist(configId: string, phoneE164: string): Promise<boolean> {
  const { data, error } = await supabaseServiceRole
    .from('anti_spam_blacklist')
    .select('id')
    .eq('config_id', configId)
    .eq('phone_e164', phoneE164)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return !error && !!data;
}

/**
 * Processa evento group-participants.update (ou group.update) com adição de participante.
 */
async function handleParticipantAdd(
  event: WebhookEventRow,
  config: AntiSpamConfig,
  bancaId: string,
  payload: any
): Promise<void> {
  const action = payload?.data?.action ?? payload?.action ?? '';
  const normalizedAction = String(action).toLowerCase();
  if (normalizedAction !== 'add') return;

  const groupJid =
    payload?.data?.id ?? payload?.data?.key?.remoteJid ?? payload?.data?.groupJid ?? event.remote_jid ?? '';
  if (!groupJid || !groupJid.includes('@g.us')) return;

  const participants = payload?.data?.participants ?? payload?.participants ?? [];
  const toCheck = Array.isArray(participants) ? participants : [participants];
  for (const p of toCheck) {
    const raw =
      p?.phoneNumber ?? p?.id ?? p?.jid ?? (typeof p === 'string' ? p : null);
    if (!raw) continue;
    const phoneE164 = normalizeToE164BR(raw) ?? (raw.includes('@') ? null : normalizeToE164BR('55' + raw.replace(/\D/g, '')));
    if (!phoneE164) continue;

    const already = await actionAlreadyDone(
      config.id,
      event.id,
      'remove_from_group',
      groupJid,
      phoneE164
    );
    if (already) continue;

    const inBl = await isInBlacklist(config.id, phoneE164);
    if (!inBl) continue;

    const removeResult = await removeParticipant(config.master_instance_id, groupJid, phoneE164);
    await recordAction(
      config.id,
      bancaId,
      event.id,
      groupJid,
      phoneE164,
      'remove_from_group',
      removeResult.success ? 'success' : 'fail',
      removeResult.error ?? null,
      { httpStatus: removeResult.httpStatus }
    );
  }
}

/**
 * Processa mensagem no grupo de denúncia: extrai telefones e adiciona à blacklist.
 */
async function handleDenunciaMessage(
  event: WebhookEventRow,
  config: AntiSpamConfig,
  bancaId: string,
  payload: any
): Promise<void> {
  const text =
    payload?.data?.message?.conversation ??
    payload?.data?.message?.extendedTextMessage?.text ??
    payload?.data?.message?.caption ??
    payload?.message?.conversation ??
    payload?.extendedTextMessage?.text ??
    '';
  const str = typeof text === 'string' ? text : String(text || '');
  const phones = extractPhones(str);
  if (phones.length === 0) return;

  const remoteJid = payload?.data?.key?.remoteJid ?? event.remote_jid ?? '';
  if (!remoteJid || remoteJid !== config.denuncia_group_jid) return;

  for (const phoneE164 of phones) {
    const already = await actionAlreadyDone(
      config.id,
      event.id,
      'add_to_blacklist',
      remoteJid,
      phoneE164
    );
    if (already) continue;

    const waJid = toWaJid(phoneE164);
    const { error } = await supabaseServiceRole.from('anti_spam_blacklist').upsert(
      {
        config_id: config.id,
        phone_e164: phoneE164,
        wa_jid: waJid,
        reason: 'denuncia_grupo',
        status: 'active',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'config_id,phone_e164', ignoreDuplicates: false }
    );

    await recordAction(
      config.id,
      bancaId,
      event.id,
      remoteJid,
      phoneE164,
      'add_to_blacklist',
      error ? 'fail' : 'success',
      error?.message ?? null
    );
  }
}

/**
 * Processa um evento (roteamento por tipo).
 */
async function processEvent(
  event: WebhookEventRow,
  configs: AntiSpamConfig[],
  bancaId: string,
  instanceNames: string[]
): Promise<void> {
  if (!event.instance_name || !instanceNames.includes(event.instance_name)) return;

  const config = getConfigForInstance(configs, event.instance_name);
  if (!config) return;

  const payload = event.payload_normalized ?? event.payload;
  const eventTypeNorm = normalizeEventType(event.event_type);

  if (EVENT_TYPES_PARTICIPANTS.some((t) => normalizeEventType(t) === eventTypeNorm)) {
    await handleParticipantAdd(event, config, bancaId, payload);
    return;
  }

  if (EVENT_TYPES_MESSAGES.some((t) => normalizeEventType(t) === eventTypeNorm)) {
    const data = payload && typeof payload === 'object' && 'data' in payload ? (payload as { data?: { key?: { remoteJid?: string } } }).data : undefined;
    const remoteJid = data?.key?.remoteJid ?? event.remote_jid ?? '';
    if (remoteJid === config.denuncia_group_jid) {
      await handleDenunciaMessage(event, config, bancaId, payload);
    }
  }
}

/**
 * Um ciclo de processamento: carrega configs, para cada banca busca eventos, processa e atualiza cursor.
 * Exportado para uso em POST /api/admin/anti-spam/test-run.
 */
export async function runCycle(): Promise<void> {
  const configs = await loadActiveConfigs();
  if (configs.length === 0) return;

  const byBanca = groupConfigsByBanca(configs);

  for (const [bancaId, { instanceNames, configs: bancaConfigs }] of byBanca) {
    const names = Array.from(instanceNames);
    if (names.length === 0) continue;

    const cursor = await getCursor(bancaId);
    const events = await fetchNextEvents(bancaId, names, cursor);
    if (events.length === 0) continue;

    for (const event of events) {
      try {
        await processEvent(event, bancaConfigs, bancaId, names);
      } catch (err: any) {
        console.error('[AntiSpam] Erro ao processar evento:', event.id, err?.message || err);
      }
    }

    const last = events[events.length - 1];
    await updateCursor(bancaId, { id: last.id, received_at: last.received_at });
  }
}

/**
 * Inicia o worker em loop de polling.
 */
export function startAntiSpamWorker(): () => void {
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await runCycle();
      } catch (err: any) {
        console.error('[AntiSpam] Erro no ciclo:', err?.message || err);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  loop();
  return () => {
    stopped = true;
  };
}
