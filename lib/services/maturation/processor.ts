/**
 * Processor module for maturation steps.
 * Compartilhado entre o tick agendado (ex.: cron Linux → maturation-tick) e rotas Next.js (ex.: /api/maturation/cron-tick).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { maybeMarkEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';
import { VIRGIN_AUTO_MATURATION_PLAN_ID } from '@/lib/maturation/job-lifecycle';
import { reconcileOrphanedMasterInstanceLocks } from '@/lib/maturation/reconcile-master-instance-locks';
import { MATURATION_MIN_STEP_DELAY_SEC } from '@/lib/maturation/min-step-delay';
import { evolutionMaturationDbStatusIsConnected } from '@/lib/utils/evolution-instance-status';
import { resolveEvolutionSendMediaMeta } from '@/lib/crm/evolution-send-media-meta';
import {
  loadVirginMessagePlansFromDb,
  meshMessagePlanIndex,
  virginPlanToMeshPool,
  virginWarmupPlanIndex,
} from '@/lib/maturation/virgin-message-plans';

/**
 * Quantos steps são reivindicados por lote no RPC claim_maturation_steps.
 * Aumentado para 10 para processar mais steps por tick em planos longos.
 */
const CLAIM_LIMIT = 10;
const MAX_ATTEMPTS = 3;
/**
 * Timeout por request à Evolution API. Mantido em 12s para caber no orçamento do tick.
 * O cron-tick tem maxDuration=55s, então temos ~50s úteis para processar steps.
 */
const FETCH_TIMEOUT_MS = 12000;
/** Steps travados em 'processing' por mais de X ms são resetados para 'pending' */
const STUCK_PROCESSING_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos
const DEFAULT_MEDIA_BUCKET = 'maturation-videos';
const VIRGIN_MEDIA_BUCKET = 'virgin-maturation-media';

const VIRGIN_CONNECTION_TEST_MS = 24 * 60 * 60 * 1000;
const VIRGIN_CONTACT_WARMUP_MS = 2 * 60 * 60 * 1000;
const VIRGIN_GROUP_WARMUP_MS = 24 * 60 * 60 * 1000;

type VirginMessage =
  | { type: 'text'; text: string }
  | { type: 'video'; media_path: string; caption?: string }
  | { type: 'image'; media_path: string; caption?: string }
  | { type: 'audio'; media_path: string };

const VIRGIN_MESSAGES_FALLBACK: VirginMessage[] = [
  { type: 'text', text: 'Oi!' },
  { type: 'text', text: 'Tudo bem?' },
  { type: 'text', text: 'Beleza' },
  { type: 'text', text: 'Ok' },
  { type: 'text', text: '👍' },
  { type: 'text', text: 'Legal' },
  { type: 'text', text: 'Combina' },
  { type: 'text', text: 'Até mais' },
];

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

/** Remove sufixo @s.whatsapp.net - Evolution API espera apenas o número no campo number para contatos 1:1 */
function normalizeNumberForEvolution(numberOrJid: string): string {
  if (!numberOrJid || typeof numberOrJid !== 'string') return numberOrJid || '';
  const s = numberOrJid.trim();
  if (s.endsWith('@s.whatsapp.net')) return s.replace(/@s\.whatsapp\.net$/, '');
  return s;
}

const LOG_PREFIX = '[MATURATION]';
/** Logs do maturador manual (jobs com plano / Start na tela). */
const LOG_MANUAL = '[MATURADOR]';
/** Logs do auto maturador (instâncias virgem em maturação automática). */
const LOG_AUTO = '[AUTO-MATURADOR]';
/** Detalhe por request à Evolution (URL/body). */
const VERBOSE_EVOLUTION_LOGS = process.env.MATURATION_VERBOSE_EVOLUTION_LOGS === 'true';
/**
 * Logs chatos do tick: fases, “próximo step em…”, resumo longo, heartbeat do auto-maturador, etc.
 * Default false — erros e avisos importantes continuam em console.warn/error.
 */
const MATURATION_VERBOSE_LOGS = process.env.MATURATION_VERBOSE_LOGS === 'true';

function logVerbose(...args: unknown[]) {
  if (MATURATION_VERBOSE_LOGS) console.log(...args);
}

function extractErrorMessage(responseText: string, fallback: string): string {
  try {
    const data = JSON.parse(responseText);
    const raw = data?.response?.message ?? data?.message ?? data?.error;
    if (Array.isArray(raw)) {
      return raw
        .map((item: unknown) =>
          typeof item === 'string'
            ? item
            : item != null && typeof item === 'object'
              ? JSON.stringify(item)
              : String(item)
        )
        .join('; ');
    }
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') return JSON.stringify(raw);
  } catch {}
  return fallback;
}

/** Evolution sendText/sendMedia 400: destino não tem conta no WhatsApp — retry não ajuda. */
function isEvolutionRecipientNotOnWhatsApp(params: { error?: string; httpStatus?: number }): boolean {
  if (params.httpStatus !== 400) return false;
  const e = params.error || '';
  return /"exists"\s*:\s*false/i.test(e) || /\bexists\s*:\s*false\b/i.test(e);
}

function formatEvolutionRecipientNotOnWhatsAppError(error: string): string {
  const m = error.match(/"number"\s*:\s*"([^"]+)"/);
  if (m?.[1]) {
    return `O número ${m[1]} não está no WhatsApp (conta inexistente). Ajuste o destino da maturação para um número com WhatsApp ativo.`;
  }
  return 'O destino não está no WhatsApp (exists=false). Confira o número usado na maturação.';
}

/** Chave estável para comparar destinos (Evolution / steps). */
function normalizeMaturationDestKey(chatId: string): string {
  const s = String(chatId || '').trim().toLowerCase();
  if (!s) return '';
  const local = s.split('@')[0] || s;
  const digits = local.replace(/\D/g, '');
  return digits.length >= 8 ? digits : local;
}

function isStoredErrorDestinoSemWhatsApp(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes('não está no whatsapp') ||
    e.includes('conta inexistente') ||
    e.includes('exists=false') ||
    e.includes('"exists":false') ||
    /exists["']?\s*:\s*false/i.test(error)
  );
}

async function fetchInvalidWhatsappDestKeysForJobIds(
  supabase: SupabaseClient,
  jobIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (jobIds.length === 0) return out;
  const { data: failedRows, error } = await supabase
    .from('maturation_steps')
    .select('target_chat_id, error')
    .in('job_id', jobIds)
    .eq('status', 'failed');
  if (error || !failedRows?.length) return out;
  for (const row of failedRows as { target_chat_id?: string | null; error?: string | null }[]) {
    const tid = row.target_chat_id && String(row.target_chat_id).trim();
    if (!tid || !row.error || !isStoredErrorDestinoSemWhatsApp(row.error)) continue;
    out.add(normalizeMaturationDestKey(tid));
  }
  return out;
}

/** Steps já falhados com exists=false (mesmo escopo de campanha ou job solto). */
async function loadInvalidWhatsappDestKeysForScope(
  supabase: SupabaseClient,
  campaignId: string | null | undefined,
  fallbackJobId: string
): Promise<Set<string>> {
  const cid = campaignId && String(campaignId).trim();
  if (cid) {
    const { data: jobs } = await supabase.from('maturation_jobs').select('id').eq('campaign_id', cid);
    const jids = (jobs ?? []).map((j: { id: string }) => j.id).filter(Boolean);
    return fetchInvalidWhatsappDestKeysForJobIds(supabase, jids);
  }
  return fetchInvalidWhatsappDestKeysForJobIds(supabase, [fallbackJobId]);
}

/**
 * Mapa escopo → destinos sem WhatsApp já conhecidos (DB + enriquecido durante o tick).
 * Escopo: `c:<campaign_id>` ou `j:<job_id>` (job sem campanha).
 */
async function loadInvalidWhatsappDestinationMapForRunningJobs(
  supabase: SupabaseClient
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const { data: running, error } = await supabase.from('maturation_jobs').select('id, campaign_id').eq('status', 'running');
  if (error || !running?.length) return map;

  const uniqueCids = [...new Set(running.map((r: { campaign_id?: string | null }) => r.campaign_id).filter(Boolean))] as string[];

  for (const cid of uniqueCids) {
    const set = await loadInvalidWhatsappDestKeysForScope(supabase, cid, '');
    map.set(`c:${cid}`, set);
  }

  const soloJobIds = running
    .filter((r: { campaign_id?: string | null }) => !r.campaign_id || !String(r.campaign_id).trim())
    .map((r: { id: string }) => r.id);
  if (soloJobIds.length === 0) return map;

  const { data: soloFailed } = await supabase
    .from('maturation_steps')
    .select('job_id, target_chat_id, error')
    .in('job_id', soloJobIds)
    .eq('status', 'failed');

  for (const row of soloFailed ?? []) {
    const r = row as { job_id: string; target_chat_id?: string | null; error?: string | null };
    const tid = r.target_chat_id && String(r.target_chat_id).trim();
    if (!tid || !r.error || !isStoredErrorDestinoSemWhatsApp(r.error)) continue;
    const sk = `j:${r.job_id}`;
    if (!map.has(sk)) map.set(sk, new Set());
    map.get(sk)!.add(normalizeMaturationDestKey(tid));
  }

  return map;
}

function maturationScopeKey(campaignId: string | null | undefined, jobId: string): string {
  const cid = campaignId && String(campaignId).trim();
  return cid ? `c:${cid}` : `j:${jobId}`;
}

export type ProcessStepOpts = {
  /** Mutável durante o tick: passos seguintes e mesh evitam Evolution para o mesmo destino. */
  invalidWhatsappDestByScope?: Map<string, Set<string>>;
};

function noteInvalidWhatsappDestination(
  opts: ProcessStepOpts | undefined,
  scopeKey: string,
  destKey: string
): void {
  if (!opts?.invalidWhatsappDestByScope || !destKey) return;
  let s = opts.invalidWhatsappDestByScope.get(scopeKey);
  if (!s) {
    s = new Set();
    opts.invalidWhatsappDestByScope.set(scopeKey, s);
  }
  s.add(destKey);
}

function isConnectionClosedError(params: { error?: string; httpStatus?: number }): boolean {
  const msg = (params.error || '').toLowerCase();
  return msg.includes('connection closed') || msg.includes('conexão fechada') || msg.includes('connection is closed');
}

/** Evolution / WhatsApp: limite de envio — pausar campanha em vez de martelar retry. */
function isEvolutionRateLimitError(params: { error?: string; httpStatus?: number }): boolean {
  if (params.httpStatus === 429) return true;
  const msg = (params.error || '').toLowerCase();
  return (
    msg.includes('rate-overlimit') ||
    msg.includes('rate overlimit') ||
    msg.includes('overlimit') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

function evolutionErrorIsRateLimit(responseText: string, httpStatus: number): boolean {
  const err = extractErrorMessage(responseText, `HTTP ${httpStatus}`);
  return isEvolutionRateLimitError({ error: err, httpStatus });
}

/**
 * Proxy/nginx/Evolution fora do ar — não adianta retry com backoff (martela 502).
 * Encerra jobs em execução e libera master_instances.
 */
function isEvolutionGatewayOrUpstreamError(params: { error?: string; httpStatus?: number }): boolean {
  const s = params.httpStatus;
  if (s === 502 || s === 503 || s === 504) return true;
  const msg = (params.error || '').toLowerCase();
  if (msg.includes('bad gateway') || msg.includes('502')) return true;
  if (msg.includes('service unavailable') || msg.includes('503')) return true;
  if (msg.includes('gateway timeout') || msg.includes('504')) return true;
  if (/<\s*html[\s>]/i.test(params.error || '') || /<\s*!doctype/i.test(params.error || '')) return true;
  return false;
}

/**
 * Encerra job(s) de maturação (e irmãos de campanha) como failed, cancela steps pendentes e libera locks.
 */
async function terminateMaturationJobsInfrastructureFailure(
  supabase: SupabaseClient,
  params: {
    triggerJobId: string;
    stepId: string | null;
    instanceName: string;
    failReason: string;
    logLabel: string;
    userTitle: string;
    userContent: string;
    httpStatus?: number;
    errorDetail?: string;
  }
): Promise<boolean> {
  const {
    triggerJobId,
    stepId,
    instanceName,
    failReason,
    logLabel,
    userTitle,
    userContent,
    httpStatus,
    errorDetail,
  } = params;
  const nowIso = new Date().toISOString();

  const { data: jobMeta } = await supabase.from('maturation_jobs').select('campaign_id').eq('id', triggerJobId).maybeSingle();

  let jobIdsToEnd: string[] = [triggerJobId];
  const cid = jobMeta?.campaign_id as string | null | undefined;
  if (cid) {
    const { data: siblings } = await supabase
      .from('maturation_jobs')
      .select('id')
      .eq('campaign_id', cid)
      .eq('status', 'running');
    if (siblings?.length) jobIdsToEnd = siblings.map((r) => r.id);
  }

  const { data: jobsBefore } = await supabase
    .from('maturation_jobs')
    .select('id, master_instance_id')
    .in('id', jobIdsToEnd)
    .eq('status', 'running');

  const { data: endedRows } = await supabase
    .from('maturation_jobs')
    .update({ status: 'failed', updated_at: nowIso, ended_at: nowIso })
    .in('id', jobIdsToEnd)
    .eq('status', 'running')
    .select('id');

  if ((endedRows?.length || 0) === 0) return false;

  const masterIds = [...new Set((jobsBefore || []).map((r) => r.master_instance_id).filter(Boolean))] as string[];
  if (masterIds.length > 0) {
    await supabase
      .from('master_instances')
      .update({ is_locked: false, locked_job_id: null, locked_at: null })
      .in('id', masterIds);
  }

  await supabase
    .from('maturation_steps')
    .update({
      status: 'failed',
      locked_at: null,
      locked_by: null,
      error: failReason,
    })
    .in('job_id', jobIdsToEnd)
    .in('status', ['pending', 'processing']);

  console.warn(
    `${LOG_MANUAL} ${logLabel} → ${endedRows!.length} job(s) finalizado(s) (failed)${cid ? ' campanha/malha' : ''} · ${instanceName}`
  );
  await createMessage(supabase, {
    jobId: triggerJobId,
    stepId: stepId ?? undefined,
    direction: 'system',
    type: 'error',
    title: userTitle,
    content: userContent,
    status: 'failed',
    httpStatus,
    error: errorDetail,
  });
  return true;
}

/**
 * Garante que o plano virgem usado pelos participant jobs mesh existe e está ativo.
 * Deve rodar ANTES de failRunningMaturationJobsWithInactivePlans para que o plano
 * nunca seja encontrado inativo naquela checagem e os jobs não sejam mortos.
 */
async function ensureMeshVirginPlanActive(supabase: SupabaseClient): Promise<void> {
  const { data: existing } = await supabase
    .from('maturation_plans')
    .select('id, is_active')
    .eq('id', VIRGIN_AUTO_MATURATION_PLAN_ID)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from('maturation_plans').insert({
      id: VIRGIN_AUTO_MATURATION_PLAN_ID,
      name: 'Plano Mesh (auto)',
      description: 'Plano interno do ciclo mesh. Não editar.',
      is_active: true,
    });
    if (error && !error.message?.includes('duplicate')) {
      console.warn(`${LOG_MESH} Falha ao criar plano virgem: ${error.message}`);
    } else if (!error) {
      console.log(`${LOG_MESH} Plano virgem (${VIRGIN_AUTO_MATURATION_PLAN_ID}) criado automaticamente.`);
    }
    return;
  }

  if (existing.is_active !== true) {
    await supabase
      .from('maturation_plans')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', VIRGIN_AUTO_MATURATION_PLAN_ID);
    console.log(`${LOG_MESH} Plano virgem reativado automaticamente.`);
  }
}

/**
 * Jobs em running cujo plano foi desativado não são mais elegíveis ao claim (migration),
 * mas ficariam presos para sempre. Finaliza em lote no início do tick.
 */
async function failRunningMaturationJobsWithInactivePlans(supabase: SupabaseClient): Promise<void> {
  const { data: running, error } = await supabase.from('maturation_jobs').select('id, plan_id, campaign_id').eq('status', 'running');
  if (error || !running?.length) return;

  const planIds = [...new Set(running.map((r) => r.plan_id).filter(Boolean))] as string[];
  if (planIds.length === 0) return;

  const { data: plans } = await supabase.from('maturation_plans').select('id, is_active').in('id', planIds);
  const planById = new Map((plans || []).map((p) => [p.id, p.is_active === true]));
  const inactiveOrMissing = new Set<string>();
  for (const pid of planIds) {
    if (!planById.get(pid)) inactiveOrMissing.add(pid);
  }

  const badJobs = running.filter((j) => !j.plan_id || inactiveOrMissing.has(j.plan_id as string));
  if (badJobs.length === 0) return;

  // Batch-fetch instance labels for all bad jobs in one query (avoids N+1)
  const badJobIds = badJobs.map((j) => j.id);
  const { data: labelRows } = await supabase
    .from('maturation_jobs')
    .select(`id, master_instances ( evolution_instances ( instance_name ) )`)
    .in('id', badJobIds);
  const labelByJobId = new Map<string, string>();
  for (const lr of labelRows || []) {
    const mi = (lr as any)?.master_instances;
    labelByJobId.set(lr.id, mi?.evolution_instances?.instance_name ?? '—');
  }

  const seenKey = new Set<string>();
  for (const row of badJobs) {
    const ck = row.campaign_id != null ? `c:${row.campaign_id}` : `j:${row.id}`;
    if (seenKey.has(ck)) continue;
    seenKey.add(ck);

    const instanceLabel = labelByJobId.get(row.id) ?? '—';

    await terminateMaturationJobsInfrastructureFailure(supabase, {
      triggerJobId: row.id,
      stepId: null,
      instanceName: instanceLabel,
      failReason: 'Plano de maturação inativo ou removido. Envios cancelados.',
      logLabel: 'Plano inativo',
      userTitle: '⛔ Plano de maturação inativo',
      userContent: `O plano deste job não está mais ativo. A maturação foi encerrada.`,
      errorDetail: 'maturation_plans.is_active = false',
    });
  }
}

async function sendText(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string;
  text: string;
}): Promise<{ success: boolean; latencyMs: number; httpStatus?: number; error?: string }> {
  const { baseUrl, instanceName, apiKey, number, text } = params;
  const numberNorm = normalizeNumberForEvolution(number);
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendText/${instanceName}`;
  const body = { number: numberNorm, text };
  if (VERBOSE_EVOLUTION_LOGS) {
    console.log(`${LOG_PREFIX} [Evolution] POST ${url}`);
    console.log(`${LOG_PREFIX} [Evolution] body: number=${numberNorm} text="${text?.substring(0, 80)}${(text?.length ?? 0) > 80 ? '…' : ''}"`);
  }
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const responseText = await response.text();
    const rateLimited = !response.ok && evolutionErrorIsRateLimit(responseText, response.status);
    if (response.ok) {
      if (VERBOSE_EVOLUTION_LOGS) {
        console.log(`${LOG_PREFIX} [Evolution] ✅ sendText HTTP ${response.status} (${latencyMs}ms) → ${instanceName} → ${numberNorm}`);
      }
      return { success: true, latencyMs, httpStatus: response.status };
    }
    if (rateLimited) {
      console.warn(`${LOG_PREFIX} [Evolution] ⚠️ RATE-LIMIT HTTP ${response.status} (${latencyMs}ms) → ${instanceName}`);
    } else {
      const errSnippet = responseText?.substring(0, 120);
      console.warn(`${LOG_PREFIX} [Evolution] ❌ HTTP ${response.status} (${latencyMs}ms) → ${instanceName}: ${errSnippet}`);
    }
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const msg = error.name === 'AbortError' ? `Timeout (>${FETCH_TIMEOUT_MS}ms)` : error.message;
    console.warn(`${LOG_PREFIX} [Evolution] ❌ EXCEPTION (${latencyMs}ms) → ${instanceName}: ${msg}`);
    return { success: false, latencyMs, error: msg };
  }
}

/**
 * Evolution exige `media` / `audio` como string URL (http/https).
 * Alguns payloads gravam objeto (ex.: { signedUrl } do Storage) — normaliza aqui.
 */
function coerceHttpMediaUrl(input: unknown, depth = 0): string | null {
  if (input == null || depth > 6) return null;
  if (typeof input === 'string') {
    const t = input.trim();
    return /^https?:\/\//i.test(t) ? t : null;
  }
  if (typeof input === 'object') {
    if (input instanceof URL) {
      return coerceHttpMediaUrl(input.href, depth + 1);
    }
    const ctor = (input as { constructor?: { name?: string } }).constructor?.name;
    if (ctor === 'String') {
      return coerceHttpMediaUrl(String(input as object), depth + 1);
    }
    if (Array.isArray(input) && input.length > 0) {
      return coerceHttpMediaUrl(input[0], depth + 1);
    }
    if (!Array.isArray(input)) {
      const o = input as Record<string, unknown>;
      const keys = [
        'signedUrl',
        'signedURL',
        'signed_url',
        'url',
        'publicUrl',
        'publicURL',
        'href',
        'media',
        'media_url',
        'downloadUrl',
        'downloadURL',
        'data',
        'path',
        'fullPath',
        'value',
        'link',
        'src',
      ] as const;
      for (const k of keys) {
        const out = coerceHttpMediaUrl(o[k], depth + 1);
        if (out) return out;
      }
    }
  }
  return null;
}

function logMediaUrlPreview(label: string, rawUrl: unknown): string {
  const s = coerceHttpMediaUrl(rawUrl);
  if (!s) {
    if (rawUrl == null) return `${label}=(vazio)`;
    try {
      const j = typeof rawUrl === 'object' ? JSON.stringify(rawUrl).slice(0, 160) : String(rawUrl).slice(0, 160);
      return `${label}=(não é URL) ${j}${String(j).length >= 160 ? '…' : ''}`;
    } catch {
      return `${label}=(tipo inválido)`;
    }
  }
  try {
    const u = new URL(s);
    const pathPrev = u.pathname.length > 48 ? `${u.pathname.slice(0, 48)}…` : u.pathname;
    return `${label}=${u.protocol}//${u.host}${pathPrev} len=${s.length}`;
  } catch {
    return s.length > 100 ? `${label}=${s.slice(0, 100)}…[${s.length}b]` : `${label}=${s}`;
  }
}

async function sendMedia(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string;
  mediaUrl: unknown;
  /** Mesmo shape do disparo em massa (grupos): mediatype, mimetype, fileName */
  evolutionMeta: { mediatype: string; mimetype: string; fileName: string };
  caption?: string;
}): Promise<{ success: boolean; latencyMs: number; httpStatus?: number; error?: string; mediaUrl?: string }> {
  const { baseUrl, instanceName, apiKey, number, mediaUrl, evolutionMeta, caption } = params;
  const numberNorm = normalizeNumberForEvolution(number);
  const mediaStr = coerceHttpMediaUrl(mediaUrl);
  if (!mediaStr || typeof mediaStr !== 'string') {
    const hint =
      typeof mediaUrl === 'object' && mediaUrl != null
        ? JSON.stringify(mediaUrl).slice(0, 240)
        : String(mediaUrl ?? '').slice(0, 120);
    console.warn(`${LOG_PREFIX} [Evolution] sendMedia abort: media não é URL http(s) string | recebido=${hint}`);
    return { success: false, latencyMs: 0, error: 'Campo media deve ser URL http(s) string para a Evolution' };
  }
  /** Igual activation mass-send: sempre primitivo string no JSON (Evolution valida tipo). */
  const mediaPrimitive = String(mediaStr);
  if (!/^https?:\/\//i.test(mediaPrimitive)) {
    console.warn(`${LOG_PREFIX} [Evolution] sendMedia abort: URL inválida após coerção`);
    return { success: false, latencyMs: 0, error: 'Campo media deve ser URL http(s) string para a Evolution' };
  }
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendMedia/${instanceName}`;
  const body: Record<string, unknown> = {
    number: numberNorm,
    mediatype: evolutionMeta.mediatype,
    mimetype: evolutionMeta.mimetype,
    media: mediaPrimitive,
    fileName: evolutionMeta.fileName,
  };
  if (caption) body.caption = caption;
  const capLen = caption != null ? String(caption).length : 0;
  console.log(`${LOG_PREFIX} [Evolution] POST ${url}`);
  console.log(
    `${LOG_PREFIX} [Evolution] sendMedia req: ${logMediaUrlPreview('media', mediaPrimitive)} | number=${numberNorm} | mediatype=${evolutionMeta.mediatype} | mimetype=${evolutionMeta.mimetype} | captionLen=${capLen} | fileName=${evolutionMeta.fileName}`
  );
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const responseText = await response.text();
    const rateLimited = !response.ok && evolutionErrorIsRateLimit(responseText, response.status);
    if (response.ok) {
      console.log(
        `${LOG_PREFIX} [Evolution] ✅ sendMedia HTTP ${response.status} (${latencyMs}ms) → ${instanceName} → ${numberNorm} | ${logMediaUrlPreview('media', mediaStr)}`
      );
      return { success: true, latencyMs, httpStatus: response.status, mediaUrl: mediaStr };
    }
    const bodySnippet = responseText?.substring(0, 1200) ?? '';
    if (rateLimited) {
      console.warn(
        `${LOG_PREFIX} [Evolution] ⚠️ sendMedia HTTP ${response.status} RATE-LIMIT (${latencyMs}ms) → ${instanceName} | body: ${bodySnippet.slice(0, 400)}`
      );
    } else {
      console.warn(
        `${LOG_PREFIX} [Evolution] ❌ sendMedia HTTP ${response.status} (${latencyMs}ms) → ${instanceName} → ${numberNorm} | ${logMediaUrlPreview('media', mediaStr)}`
      );
      console.warn(`${LOG_PREFIX} [Evolution] sendMedia resposta (até 1200 chars): ${bodySnippet}`);
    }
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg, mediaUrl: mediaStr };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const msg = error.name === 'AbortError' ? `Timeout (>${FETCH_TIMEOUT_MS}ms)` : error.message;
    console.warn(
      `${LOG_PREFIX} [Evolution] ❌ sendMedia EXCEPTION (${latencyMs}ms) → ${instanceName}: ${msg} | ${logMediaUrlPreview('media', mediaStr)}`
    );
    return { success: false, latencyMs, error: msg, mediaUrl: mediaStr };
  }
}

async function sendAudio(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string;
  audioUrl: unknown;
}): Promise<{ success: boolean; latencyMs: number; httpStatus?: number; error?: string }> {
  const { baseUrl, instanceName, apiKey, number, audioUrl } = params;
  const numberNorm = normalizeNumberForEvolution(number);
  const audioStr = coerceHttpMediaUrl(audioUrl);
  if (!audioStr) {
    const hint =
      typeof audioUrl === 'object' && audioUrl != null
        ? JSON.stringify(audioUrl).slice(0, 240)
        : String(audioUrl ?? '').slice(0, 120);
    console.warn(`${LOG_PREFIX} [Evolution] sendWhatsAppAudio abort: audio não é URL http(s) string | recebido=${hint}`);
    return { success: false, latencyMs: 0, error: 'Campo audio deve ser URL http(s) string para a Evolution' };
  }
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendWhatsAppAudio/${instanceName}`;
  const audioPrimitive = String(audioStr);
  const body: Record<string, unknown> = { number: numberNorm, audio: audioPrimitive };
  console.log(`${LOG_PREFIX} [Evolution] POST ${url}`);
  console.log(
    `${LOG_PREFIX} [Evolution] sendAudio req: ${logMediaUrlPreview('audio', audioPrimitive)} | number=${numberNorm}`
  );
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const responseText = await response.text();
    const rateLimited = !response.ok && evolutionErrorIsRateLimit(responseText, response.status);
    if (response.ok) {
      console.log(
        `${LOG_PREFIX} [Evolution] ✅ sendWhatsAppAudio HTTP ${response.status} (${latencyMs}ms) → ${instanceName} → ${numberNorm} | ${logMediaUrlPreview('audio', audioStr)}`
      );
      return { success: true, latencyMs, httpStatus: response.status };
    }
    const bodySnippet = responseText?.substring(0, 1200) ?? '';
    if (rateLimited) {
      console.warn(
        `${LOG_PREFIX} [Evolution] ⚠️ sendWhatsAppAudio HTTP ${response.status} RATE-LIMIT (${latencyMs}ms) → ${instanceName} | body: ${bodySnippet.slice(0, 400)}`
      );
    } else {
      console.warn(
        `${LOG_PREFIX} [Evolution] ❌ sendWhatsAppAudio HTTP ${response.status} (${latencyMs}ms) → ${instanceName} → ${numberNorm} | ${logMediaUrlPreview('audio', audioStr)}`
      );
      console.warn(`${LOG_PREFIX} [Evolution] sendWhatsAppAudio resposta (até 1200 chars): ${bodySnippet}`);
    }
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const msg = error.name === 'AbortError' ? `Timeout (>${FETCH_TIMEOUT_MS}ms)` : error.message;
    console.warn(
      `${LOG_PREFIX} [Evolution] ❌ sendWhatsAppAudio EXCEPTION (${latencyMs}ms) → ${instanceName}: ${msg} | ${logMediaUrlPreview('audio', audioStr)}`
    );
    return { success: false, latencyMs, error: msg };
  }
}

async function getSignedUrl(
  supabase: SupabaseClient,
  assetPath: string,
  bucket: string = DEFAULT_MEDIA_BUCKET
): Promise<{ url: string | null; bucket: string; objectPath: string; errorMessage?: string }> {
  let b = bucket;
  let p = assetPath;
  if (assetPath.includes('/')) {
    const parts = assetPath.split('/');
    b = parts[0];
    p = parts.slice(1).join('/');
  }
  try {
    const { data, error } = await supabase.storage.from(b).createSignedUrl(p, 3600);
    if (error) {
      return { url: null, bucket: b, objectPath: p, errorMessage: error.message };
    }
    const signed = data?.signedUrl?.trim() || null;
    if (!signed) {
      return { url: null, bucket: b, objectPath: p, errorMessage: 'Resposta sem signedUrl' };
    }
    return { url: signed, bucket: b, objectPath: p };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url: null, bucket: b, objectPath: p, errorMessage: msg };
  }
}

async function createMessage(supabase: SupabaseClient, params: any): Promise<void> {
  await supabase.from('maturation_messages').insert({
    job_id: params.jobId,
    step_id: params.stepId || null,
    direction: params.direction,
    instance_label: params.instanceLabel || null,
    type: params.type,
    title: params.title || null,
    content: params.content || null,
    media_url: params.mediaUrl || null,
    status: params.status || null,
    latency_ms: params.latencyMs || null,
    http_status: params.httpStatus || null,
    error: params.error || null,
  });
}

function calculateBackoff(attempt: number): number {
  const backoffs = [60, 180, 600];
  return backoffs[Math.min(attempt - 1, backoffs.length - 1)];
}

async function processStep(supabase: SupabaseClient, step: any, opts?: ProcessStepOpts): Promise<void> {
  const { id, job_id, step_index, type, instance_name, target_chat_id, base_url, api_key, payload_json, attempts } = step;

  /**
   * O RPC claim_maturation_steps só enxerga jobs `running` no momento do claim, mas o mesmo tick
   * pode processar o lote segundos depois — se o usuário pausar nesse intervalo, sem este check
   * as mensagens ainda seriam enviadas. Também cobre catch-up longo e ticks encadeados.
   */
  const { data: jobSnap } = await supabase
    .from('maturation_jobs')
    .select('status, plan_id, campaign_id')
    .eq('id', job_id)
    .maybeSingle();
  if (!jobSnap || jobSnap.status !== 'running') {
    const jst = jobSnap?.status;
    const revertPending = jst === 'paused';
    await supabase
      .from('maturation_steps')
      .update({
        status: revertPending ? 'pending' : 'skipped',
        error: revertPending
          ? null
          : jst === 'aborted'
            ? 'Job abortado'
            : 'Job não está em execução',
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id)
      .eq('status', 'processing');
    logVerbose(
      `${LOG_MANUAL} Step job=${job_id} step_index=${step_index} ignorado: job.status=${jst ?? 'missing'} (esperado running)`
    );
    return;
  }

  if (!target_chat_id) {
    const msg = 'Destino não definido para este step.';
    await supabase.from('maturation_steps').update({ status: 'failed', error: msg }).eq('id', id);
    await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', type: 'error', title: 'Step ignorado', content: msg, status: 'failed' });
    return;
  }

  const planId = jobSnap.plan_id as string | null | undefined;
  if (planId) {
    const { data: planRow } = await supabase.from('maturation_plans').select('is_active').eq('id', planId).maybeSingle();
    if (!planRow || planRow.is_active !== true) {
      await terminateMaturationJobsInfrastructureFailure(supabase, {
        triggerJobId: job_id,
        stepId: id,
        instanceName: instance_name,
        failReason: 'Plano de maturação inativo ou removido. Envios cancelados.',
        logLabel: 'Plano inativo',
        userTitle: '⛔ Plano de maturação inativo',
        userContent: `O plano deste job não está mais ativo. A maturação foi encerrada. Instância: ${instance_name}.`,
        errorDetail: 'maturation_plans.is_active = false',
      });
      return;
    }
  } else {
    await terminateMaturationJobsInfrastructureFailure(supabase, {
      triggerJobId: job_id,
      stepId: id,
      instanceName: instance_name,
      failReason: 'Job sem plan_id válido. Envios cancelados.',
      logLabel: 'Plano ausente',
      userTitle: '⛔ Plano inválido',
      userContent: `Este job não está vinculado a um plano. Instância: ${instance_name}.`,
      errorDetail: 'maturation_jobs.plan_id ausente',
    });
    return;
  }

  const scopeKey = maturationScopeKey(jobSnap.campaign_id as string | null | undefined, job_id);
  const destKeyForWa = normalizeMaturationDestKey(String(target_chat_id));
  const invalidWaSet = opts?.invalidWhatsappDestByScope?.get(scopeKey);
  if (destKeyForWa && invalidWaSet?.has(destKeyForWa)) {
    logVerbose(
      `${LOG_MANUAL} ▶ step job=${job_id.slice(0, 8)}… idx=${step_index} type=${type} sender=${instance_name} → PULADO (destino sem WhatsApp já conhecido; sem Evolution) dest=${String(target_chat_id).slice(0, 28)}`
    );
    await supabase
      .from('maturation_steps')
      .update({
        status: 'skipped',
        error:
          'Destino sem WhatsApp — pulado automaticamente (já registrado nesta campanha/job; nenhuma chamada à Evolution).',
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id)
      .eq('status', 'processing');
    return;
  }

  console.log(
    `${LOG_MANUAL} ▶ step job=${job_id.slice(0, 8)}… idx=${step_index} type=${type} sender=${instance_name} → destino=${target_chat_id ? String(target_chat_id).slice(0, 25) : '(vazio)'}`
  );

  await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', instanceLabel: instance_name, type: 'info', title: `⏳ Enviando ${type}...`, content: `Enviando ${type} pela instância ${instance_name}`, status: 'info' });

  const { data: jobBeforeSend } = await supabase.from('maturation_jobs').select('status').eq('id', job_id).maybeSingle();
  if (!jobBeforeSend || jobBeforeSend.status !== 'running') {
    const jst = jobBeforeSend?.status;
    const revertPending = jst === 'paused';
    await supabase
      .from('maturation_steps')
      .update({
        status: revertPending ? 'pending' : 'skipped',
        error: revertPending ? null : jst === 'aborted' ? 'Job abortado antes do envio' : 'Job interrompido antes do envio',
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id)
      .eq('status', 'processing');
    logVerbose(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} cancelado antes da Evolution: job.status=${jst ?? 'missing'}`);
    return;
  }

  let result: any;
  if (type === 'text') {
    result = await sendText({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, text: payload_json?.text || '' });
  } else if (['video', 'image', 'audio'].includes(type)) {
    // media_path → Supabase Storage (gera signed URL)
    // media_url  → URL direta (usada quando o plano é criado via UI com URL externa)
    // assetPath/assetId → legado
    const storagePath = payload_json.media_path || payload_json.assetPath || payload_json.assetId;
    const directFromPayload =
      coerceHttpMediaUrl(payload_json.media_url) ??
      coerceHttpMediaUrl(payload_json.media) ??
      coerceHttpMediaUrl(payload_json.signedUrl);
    let url: string | null = null;

    console.log(
      `${LOG_PREFIX} [mídia] step job=${job_id.slice(0, 8)}… idx=${step_index} type=${type} sender=${instance_name} | storagePath=${storagePath ? String(storagePath).slice(0, 120) : '—'} | hasDirectUrl=${!!directFromPayload}`
    );

    if (storagePath) {
      const signed = await getSignedUrl(supabase, String(storagePath), DEFAULT_MEDIA_BUCKET);
      url = coerceHttpMediaUrl(signed.url);
      if (!url) {
        console.warn(
          `${LOG_PREFIX} [mídia] signed URL falhou job=${job_id.slice(0, 8)}… step=${step_index} bucket=${signed.bucket} path=${signed.objectPath.slice(0, 200)}${signed.objectPath.length > 200 ? '…' : ''} err=${signed.errorMessage || 'desconhecido'}`
        );
      } else {
        console.log(
          `${LOG_PREFIX} [mídia] signed OK job=${job_id.slice(0, 8)}… step=${step_index} bucket=${signed.bucket} | ${logMediaUrlPreview('url', url)}`
        );
      }
    } else if (directFromPayload) {
      url = directFromPayload;
      console.log(`${LOG_PREFIX} [mídia] usando URL do payload step=${step_index} | ${logMediaUrlPreview('url', url)}`);
    }

    if (!url) {
      url = coerceHttpMediaUrl(payload_json);
    }
    url = coerceHttpMediaUrl(url);
    if (!url) {
      result = { success: false, error: 'Erro ao obter URL da mídia (configure media_path ou media_url no step)' };
      console.warn(
        `${LOG_PREFIX} [mídia] sem URL resolvida job=${job_id.slice(0, 8)}… step=${step_index} type=${type} | storagePath=${storagePath || '—'} | payload.media_url=${payload_json.media_url != null ? JSON.stringify(payload_json.media_url).slice(0, 80) : '—'}`
      );
    } else {
      const mimeFromPayload =
        typeof payload_json.mimetype === 'string' && payload_json.mimetype.trim()
          ? payload_json.mimetype.trim()
          : typeof payload_json.mime_type === 'string' && payload_json.mime_type.trim()
            ? payload_json.mime_type.trim()
            : null;
      if (type === 'video') {
        const evolutionMeta = resolveEvolutionSendMediaMeta({
          attachment_url: url,
          attachment_type: 'video',
          attachment_mime: mimeFromPayload,
        });
        result = await sendMedia({
          baseUrl: base_url,
          instanceName: instance_name,
          apiKey: api_key,
          number: target_chat_id,
          mediaUrl: url,
          evolutionMeta,
          caption: payload_json.caption,
        });
      } else if (type === 'image') {
        const evolutionMeta = resolveEvolutionSendMediaMeta({
          attachment_url: url,
          attachment_type: 'image',
          attachment_mime: mimeFromPayload,
        });
        result = await sendMedia({
          baseUrl: base_url,
          instanceName: instance_name,
          apiKey: api_key,
          number: target_chat_id,
          mediaUrl: url,
          evolutionMeta,
          caption: payload_json.caption,
        });
      } else {
        result = await sendAudio({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, audioUrl: url });
      }
    }
  } else result = { success: false, error: 'Tipo desconhecido' };

  if (!result.success && ['video', 'image', 'audio'].includes(type)) {
    const errStr = typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '');
    console.warn(
      `${LOG_PREFIX} [mídia] fim step job=${job_id.slice(0, 8)}… idx=${step_index} type=${type} sender=${instance_name} → FALHA http=${result.httpStatus ?? '—'} latencyMs=${result.latencyMs ?? '—'} err=${errStr.slice(0, 600)}`
    );
  }

  const typeLabel = type === 'text' ? 'Mensagem' : type === 'video' ? 'Vídeo' : type === 'image' ? 'Imagem' : 'Áudio';
  // maturation_messages.type só aceita: 'text' | 'video' | 'info' | 'error' | 'retry'
  // 'image' e 'audio' não existem na constraint → mapeamos para 'video' como mídia genérica
  const msgType = (type === 'text' ? 'text' : 'video') as 'text' | 'video';
  if (result.success) {
    logVerbose(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} OK enviado (${result.latencyMs}ms)`);
    await supabase.from('maturation_steps').update({ status: 'sent', sent_at: new Date().toISOString(), latency_ms: result.latencyMs, http_status: result.httpStatus }).eq('id', id);
    await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'instance', instanceLabel: instance_name, type: msgType, title: `✅ ${typeLabel} enviado`, content: `${typeLabel} enviado pela instância ${instance_name}`, mediaUrl: result.mediaUrl, status: 'sent', latencyMs: result.latencyMs, httpStatus: result.httpStatus });
  } else {
    if (isConnectionClosedError({ error: result.error, httpStatus: result.httpStatus })) {
      const nowIso = new Date().toISOString();
      const pauseReason = `Instância ${instance_name} desconectada (Connection Closed). Job pausado temporariamente até reconexão da instância.`;
      const { data: pausedRows } = await supabase
        .from('maturation_jobs')
        .update({ status: 'paused', updated_at: nowIso })
        .eq('id', job_id)
        .eq('status', 'running')
        .select('id');

      // Devolve o step atual para pending sem penalizar tentativas:
      // o usuário pode retomar o job quando a instância voltar.
      await supabase
        .from('maturation_steps')
        .update({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          error: pauseReason,
        })
        .eq('id', id)
        .eq('status', 'processing');

      if ((pausedRows?.length || 0) > 0) {
        console.warn(`${LOG_MANUAL} Job ${job_id} pausado automaticamente por instância offline (${instance_name})`);
        await createMessage(supabase, {
          jobId: job_id,
          stepId: id,
          direction: 'system',
          type: 'error',
          title: '⚠️ Instância desconectada',
          content: `${pauseReason} Reconecte a instância e retome o job.`,
          status: 'failed',
          httpStatus: result.httpStatus,
          error: result.error,
        });
      }

      const mid = (step as { master_instance_id?: string }).master_instance_id;
      if (mid) {
        const { data: mi } = await supabase
          .from('master_instances')
          .select('evolution_instance_id')
          .eq('id', mid)
          .maybeSingle();
        const evoId = mi?.evolution_instance_id as string | undefined;
        if (evoId) {
          await maybeMarkEvolutionInstanceDisconnected(supabase, evoId, result.error, 'maturation');
        }
      }
      return;
    }

    if (isEvolutionRateLimitError({ error: result.error, httpStatus: result.httpStatus })) {
      const failReason =
        'Maturação encerrada: rate limit (Evolution/WhatsApp). Os passos não enviados foram cancelados.';
      await terminateMaturationJobsInfrastructureFailure(supabase, {
        triggerJobId: job_id,
        stepId: id,
        instanceName: instance_name,
        failReason,
        logLabel: 'Rate limit',
        userTitle: '⛔ Maturação encerrada (rate limit)',
        userContent: `${failReason} Instância: ${instance_name}.`,
        httpStatus: result.httpStatus,
        errorDetail: result.error,
      });
      return;
    }

    if (isEvolutionGatewayOrUpstreamError({ error: result.error, httpStatus: result.httpStatus })) {
      const failReason =
        'Maturação encerrada: Evolution ou proxy retornou erro (502/503/504 ou HTML). Job finalizado — sem novas tentativas automáticas.';
      await terminateMaturationJobsInfrastructureFailure(supabase, {
        triggerJobId: job_id,
        stepId: id,
        instanceName: instance_name,
        failReason,
        logLabel: 'Gateway/upstream',
        userTitle: '⛔ Maturação encerrada (serviço indisponível)',
        userContent: `${failReason} Instância: ${instance_name}. Verifique Evolution API e proxy.`,
        httpStatus: result.httpStatus,
        errorDetail: result.error,
      });
      return;
    }

    if (isEvolutionRecipientNotOnWhatsApp({ error: result.error, httpStatus: result.httpStatus })) {
      const friendly = formatEvolutionRecipientNotOnWhatsAppError(result.error || '');
      const finalAttempts = MAX_ATTEMPTS;
      console.warn(
        `${LOG_MANUAL} Step job=${job_id} step_index=${step_index} FALHA definitiva (destino sem WhatsApp): ${friendly} | raw=${result.error}`
      );
      await supabase
        .from('maturation_steps')
        .update({ status: 'failed', attempts: finalAttempts, error: friendly })
        .eq('id', id);
      await createMessage(supabase, {
        jobId: job_id,
        stepId: id,
        direction: 'system',
        type: 'error',
        title: '❌ Destino sem WhatsApp',
        content: `${friendly} Detalhe Evolution: ${result.error}`,
        status: 'failed',
        httpStatus: result.httpStatus,
        error: result.error,
      });
      noteInvalidWhatsappDestination(opts, scopeKey, destKeyForWa);
      return;
    }

    const { data: planForRetry } = await supabase
      .from('maturation_plans')
      .select('is_active')
      .eq('id', planId as string)
      .maybeSingle();
    if (!planForRetry || planForRetry.is_active !== true) {
      await terminateMaturationJobsInfrastructureFailure(supabase, {
        triggerJobId: job_id,
        stepId: id,
        instanceName: instance_name,
        failReason: 'Plano de maturação inativo ou removido antes de nova tentativa. Envios cancelados.',
        logLabel: 'Plano inativo (pré-retry)',
        userTitle: '⛔ Plano de maturação inativo',
        userContent: `O plano foi desativado; novas tentativas automáticas foram canceladas. Instância: ${instance_name}.`,
        errorDetail: result.error,
      });
      return;
    }

    const newAttempts = (attempts || 0) + 1;
    const errLog =
      typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '');
    console.warn(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} FALHA tentativa=${newAttempts}/${MAX_ATTEMPTS} erro=${errLog}`);
    if (newAttempts < MAX_ATTEMPTS) {
      const backoff = calculateBackoff(newAttempts);
      const next = new Date(Date.now() + backoff * 1000);
      await supabase.from('maturation_steps').update({ status: 'pending', attempts: newAttempts, scheduled_at: next.toISOString(), error: result.error }).eq('id', id);
      await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', type: 'retry', title: `🔄 Tentativa ${newAttempts}/${MAX_ATTEMPTS}`, content: `Erro: ${result.error}. Tentando em ${backoff}s...`, status: 'retrying' });
    } else {
      await supabase.from('maturation_steps').update({ status: 'failed', attempts: newAttempts, error: result.error }).eq('id', id);
      await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', type: 'error', title: `❌ Falha após ${MAX_ATTEMPTS} tentativas`, content: `Erro final: ${result.error}`, status: 'failed' });
    }
  }
}

async function updateJobProgress(supabase: SupabaseClient, jobId: string): Promise<void> {
  const [
    { count: sent },
    { count: failed },
    { count: skipped },
    { count: total },
  ] = await Promise.all([
    supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'sent'),
    supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'failed'),
    supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'skipped'),
    supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
  ]);
  const sentN = sent || 0;
  const failedN = failed || 0;
  const skippedN = skipped || 0;
  const totalN = total || 0;
  /** progress_done = apenas steps enviados com sucesso (UI e barra; falhas não aparecem como “concluído”) */
  const terminalDone = sentN + failedN + skippedN;
  await supabase.from('maturation_jobs').update({ progress_done: sentN }).eq('id', jobId);
  if (!totalN || terminalDone < totalN) return;

  const { data: jobSt } = await supabase.from('maturation_jobs').select('status, campaign_id').eq('id', jobId).maybeSingle();
  /** Não promover para finished se o job já foi failed/aborted/pausado (ex.: rate limit). */
  if (jobSt?.status !== 'running') return;
  /** Jobs de campanha mesh são perpétuos: acumulam steps a cada ciclo, nunca terminam naturalmente. */
  if (jobSt?.campaign_id) return;

  const endedAt = new Date().toISOString();
  const hasFailures = failedN > 0;
  const nextStatus = hasFailures ? 'failed' : 'finished';
  logVerbose(
    `${LOG_MANUAL} Job ${jobId} encerrado (${nextStatus}): ${terminalDone}/${totalN} steps (sent=${sentN}, failed=${failedN}, skipped=${skippedN})`
  );
  await supabase
    .from('maturation_jobs')
    .update({ status: nextStatus, ended_at: endedAt })
    .eq('id', jobId);
  const { data: j } = await supabase.from('maturation_jobs').select('master_instance_id').eq('id', jobId).single();
  if (j?.master_instance_id) {
    const { count: activeOthers } = await supabase
      .from('maturation_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('master_instance_id', j.master_instance_id)
      .in('status', ['running', 'paused', 'queued']);
    const n = activeOthers ?? 0;
    if (n === 0) {
      await supabase
        .from('master_instances')
        .update({ is_locked: false, locked_job_id: null, locked_at: null })
        .eq('id', j.master_instance_id);
    }
  }
  if (hasFailures) {
    await createMessage(supabase, {
      jobId,
      direction: 'system',
      type: 'error',
      title: '⛔ Job encerrado com falhas',
      content: `${failedN} passo(s) falharam após tentativas. Status: failed — não há mais envios agendados para este job.`,
      status: 'failed',
    });
  } else {
    await createMessage(supabase, {
      jobId,
      direction: 'system',
      type: 'info',
      title: '✅ Job finalizado',
      content: 'Todos os steps processados',
      status: 'info',
    });
  }
}

/**
 * Auto maturador: instâncias com maturation_type='virgem' passam por um ciclo de 5 dias.
 * Esta função:
 * 1. Avança as fases conforme o tempo decorrido (state machine)
 * 2. Para instâncias em fase de warmup (contact_warmup / repeating_cycle), garante que
 *    há um job de maturação ativo disparando as mensagens configuradas.
 */
async function processVirginMaturation(supabase: SupabaseClient): Promise<number> {
  const now = new Date();

  const { data: virgins, error } = await supabase
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      phone_number,
      maturation_status,
      maturation_started_at,
      maturation_ends_at,
      maturation_phase_started_at,
      maturation_paused_at,
      current_day,
      is_locked,
      evolution_api_id,
      evolution_apis ( base_url, api_key_global )
    `)
    .eq('maturation_type', 'virgem')
    .not('maturation_status', 'is', null)
    .not('maturation_status', 'in', '("completed","blocked")')
    .eq('is_active', true)
    .is('maturation_paused_at', null);

  if (error) {
    console.warn(`${LOG_AUTO} Erro ao listar instâncias virgem: ${error.message}`);
    return 0;
  }

  const list = virgins || [];
  if (list.length === 0) {
    return 0;
  }

  logVerbose(`${LOG_AUTO} ${list.length} instância(s) virgem em auto maturação ativa`);
  let processed = 0;

  for (const v of list) {
    const inst = v as any;
    const status: string = inst.maturation_status || 'waiting_connection_test';
    const phaseStartedAt = inst.maturation_phase_started_at
      ? new Date(inst.maturation_phase_started_at)
      : inst.maturation_started_at
        ? new Date(inst.maturation_started_at)
        : now;

    const elapsedMs = now.getTime() - phaseStartedAt.getTime();
    const elapsedH = elapsedMs / (60 * 60 * 1000);

    logVerbose(`${LOG_AUTO} Instância ${inst.instance_name}: status=${status} elapsed=${Math.floor(elapsedH)}h`);

    // ─── State machine de fases ───────────────────────────────────────────────

    if (status === 'waiting_connection_test') {
      // Aguarda 24h, depois vai para contact_warmup
      if (elapsedMs >= VIRGIN_CONNECTION_TEST_MS) {
        logVerbose(`${LOG_AUTO} ${inst.instance_name}: avançando para contact_warmup`);
        await supabase.from('evolution_instances').update({
          maturation_status: 'contact_warmup',
          maturation_phase_started_at: now.toISOString(),
          updated_at: now.toISOString(),
        }).eq('id', inst.id);
        await supabase.from('virgin_maturation_logs').insert({
          evolution_instance_id: inst.id,
          event_type: 'phase_advance',
          message: 'Fase avançada: waiting_connection_test → contact_warmup',
          payload_json: { from: 'waiting_connection_test', to: 'contact_warmup' },
        }).then(() => {});
        processed++;
      }
      continue;
    }

    if (status === 'contact_warmup') {
      // Envia mensagens de aquecimento por 2h, depois avança para group_warmup
      await ensureVirginWarmupJob(supabase, inst, now);

      if (elapsedMs >= VIRGIN_CONTACT_WARMUP_MS) {
        logVerbose(`${LOG_AUTO} ${inst.instance_name}: avançando para group_warmup`);
        await supabase.from('evolution_instances').update({
          maturation_status: 'group_warmup',
          maturation_phase_started_at: now.toISOString(),
          updated_at: now.toISOString(),
        }).eq('id', inst.id);
        await supabase.from('virgin_maturation_logs').insert({
          evolution_instance_id: inst.id,
          event_type: 'phase_advance',
          message: 'Fase avançada: contact_warmup → group_warmup',
          payload_json: { from: 'contact_warmup', to: 'group_warmup' },
        }).then(() => {});
        processed++;
      }
      continue;
    }

    if (status === 'group_warmup') {
      // Aguarda 24h (mensagens em grupo ou sem destino), depois vai para repeating_cycle
      await ensureVirginWarmupJob(supabase, inst, now);

      if (elapsedMs >= VIRGIN_GROUP_WARMUP_MS) {
        const newDay = Math.min((inst.current_day || 1) + 1, 5);
        const nextStatus = newDay >= 5 ? 'completed' : 'repeating_cycle';
        logVerbose(`${LOG_AUTO} ${inst.instance_name}: avançando para ${nextStatus} (dia ${newDay})`);
        await supabase.from('evolution_instances').update({
          maturation_status: nextStatus,
          maturation_phase_started_at: now.toISOString(),
          current_day: newDay,
          is_locked: nextStatus === 'completed' ? false : inst.is_locked,
          updated_at: now.toISOString(),
        }).eq('id', inst.id);
        await supabase.from('virgin_maturation_logs').insert({
          evolution_instance_id: inst.id,
          event_type: 'phase_advance',
          message: `Fase avançada: group_warmup → ${nextStatus} (dia ${newDay})`,
          payload_json: { from: 'group_warmup', to: nextStatus, day: newDay },
        }).then(() => {});
        processed++;
      }
      continue;
    }

    if (status === 'repeating_cycle') {
      // Ciclo repetido nos dias 2-5: 24h por dia
      await ensureVirginWarmupJob(supabase, inst, now);

      if (elapsedMs >= VIRGIN_GROUP_WARMUP_MS) {
        const newDay = Math.min((inst.current_day || 2) + 1, 5);
        const nextStatus = newDay >= 5 ? 'completed' : 'repeating_cycle';
        logVerbose(`${LOG_AUTO} ${inst.instance_name}: ciclo avançando para ${nextStatus} (dia ${newDay})`);
        await supabase.from('evolution_instances').update({
          maturation_status: nextStatus,
          maturation_phase_started_at: now.toISOString(),
          current_day: newDay,
          is_locked: nextStatus === 'completed' ? false : inst.is_locked,
          updated_at: now.toISOString(),
        }).eq('id', inst.id);
        await supabase.from('virgin_maturation_logs').insert({
          evolution_instance_id: inst.id,
          event_type: nextStatus === 'completed' ? 'maturation_completed' : 'phase_advance',
          message: nextStatus === 'completed'
            ? `Maturação concluída após ${newDay} dias`
            : `Ciclo avançado: dia ${inst.current_day || 2} → dia ${newDay}`,
          payload_json: { from: 'repeating_cycle', to: nextStatus, day: newDay },
        }).then(() => {});
        processed++;
      }
      continue;
    }
  }

  return list.length;
}

/**
 * Garante que a instância virgem tem um job de maturação ativo (status='running').
 * Se não tiver, cria um novo usando as mensagens configuradas em virgin_maturation_config.
 * O destino das mensagens é uma instância mestre disponível (phone_number).
 */
async function ensureVirginWarmupJob(supabase: SupabaseClient, inst: any, now: Date): Promise<void> {
  const instanceId = inst.id as string;

  // Verifica se já existe uma entrada em master_instances para esta instância virgem
  let { data: masterRow } = await supabase
    .from('master_instances')
    .select('id, is_locked')
    .eq('evolution_instance_id', instanceId)
    .maybeSingle();

  // Se não existir, cria a entrada (a instância virgem entra no pool como sender)
  if (!masterRow) {
    const { data: inserted } = await supabase
      .from('master_instances')
      .insert({ evolution_instance_id: instanceId, is_active: true, is_locked: false })
      .select('id, is_locked')
      .single();
    masterRow = inserted;
  }

  if (!masterRow) {
    console.warn(`${LOG_AUTO} ${inst.instance_name}: não foi possível registrar em master_instances`);
    return;
  }

  const { data: evoPause } = await supabase
    .from('evolution_instances')
    .select('maturation_paused_at')
    .eq('id', instanceId)
    .maybeSingle();
  if (evoPause?.maturation_paused_at) {
    logVerbose(`${LOG_AUTO} ${inst.instance_name}: auto maturação pausada — não cria job de warmup`);
    return;
  }

  const masterInstanceId = masterRow.id as string;

  /**
   * Um job de warmup por fase de maturação virgem. Antes: ao terminar (finished), o próximo tick criava
   * outro job igual — envio contínuo via Evolution mesmo “sem plano” aparente na UI.
   */
  const { data: evoPhase } = await supabase
    .from('evolution_instances')
    .select('maturation_phase_started_at, maturation_started_at')
    .eq('id', instanceId)
    .maybeSingle();
  const phaseStart =
    evoPhase?.maturation_phase_started_at || evoPhase?.maturation_started_at || null;
  if (phaseStart) {
    const { data: jobsThisPhase } = await supabase
      .from('maturation_jobs')
      .select('id, status')
      .eq('master_instance_id', masterInstanceId)
      .eq('plan_id', VIRGIN_AUTO_MATURATION_PLAN_ID)
      .gte('created_at', phaseStart);

    const jl = jobsThisPhase || [];
    const hasActiveLike = jl.some((j) => ['running', 'queued', 'paused'].includes(j.status));
    if (hasActiveLike) {
      return;
    }
    const hasTerminal = jl.some((j) => ['finished', 'failed', 'aborted'].includes(j.status));
    if (hasTerminal) {
      logVerbose(
        `${LOG_AUTO} ${inst.instance_name}: warmup já rodou nesta fase (finished/failed/aborted) — não recriar job`
      );
      return;
    }
  }

  // Verifica se já há job running para este master (redundante com o bloco acima, mantém segurança)
  const { data: activeJob } = await supabase
    .from('maturation_jobs')
    .select('id')
    .eq('master_instance_id', masterInstanceId)
    .eq('status', 'running')
    .maybeSingle();

  if (activeJob) {
    return;
  }

  // Busca planos de mensagens configurados (rotação entre planos por instância — hash estável do id)
  const plans = await loadVirginMessagePlansFromDb(supabase);
  let messages: VirginMessage[] = VIRGIN_MESSAGES_FALLBACK;
  if (plans.length > 0) {
    let pi = virginWarmupPlanIndex(instanceId, plans.length);
    let picked = plans[pi];
    if (!picked || picked.length === 0) {
      const first = plans.find((p) => p.length > 0);
      if (first) picked = first;
    }
    if (picked && picked.length > 0) messages = picked as VirginMessage[];
  }

  if (messages.length === 0) {
    console.warn(`${LOG_AUTO} ${inst.instance_name}: nenhuma mensagem configurada para warmup`);
    return;
  }

  // Encontra um destino: phone_number de outra instância mestre disponível
  const { data: targetInstance } = await supabase
    .from('master_instances')
    .select(`evolution_instances!inner ( phone_number )`)
    .eq('is_active', true)
    .neq('evolution_instance_id', instanceId)
    .limit(1)
    .maybeSingle();

  const targetEv = (targetInstance as any)?.evolution_instances;
  const targetPhone = Array.isArray(targetEv) ? targetEv[0]?.phone_number : targetEv?.phone_number;

  if (!targetPhone) {
    logVerbose(`${LOG_AUTO} ${inst.instance_name}: nenhuma instância mestre disponível como destino`);
    return;
  }

  const targetChatId = `${String(targetPhone).replace(/\D/g, '')}@s.whatsapp.net`;

  // Encontra um admin como dono do job
  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('status', 'admin')
    .limit(1)
    .maybeSingle();

  if (!adminProfile) {
    console.warn(`${LOG_AUTO} ${inst.instance_name}: nenhum admin encontrado para criar job`);
    return;
  }

  const { data: plan } = await supabase
    .from('maturation_plans')
    .select('id')
    .eq('id', VIRGIN_AUTO_MATURATION_PLAN_ID)
    .eq('is_active', true)
    .maybeSingle();

  if (!plan?.id) {
    logVerbose(`${LOG_AUTO} ${inst.instance_name}: plano auto-maturador inativo ou ausente — não cria job de warmup`);
    return;
  }
  const planId = plan.id;

  // Cria os steps a partir das mensagens configuradas
  const delaySec = MATURATION_MIN_STEP_DELAY_SEC;
  const stepsToInsert: any[] = [];
  let cumulativeDelay = 0;

  for (const msg of messages) {
    cumulativeDelay += delaySec;
    const scheduledAt = new Date(now.getTime() + cumulativeDelay * 1000);
    let type: string;
    let payload: Record<string, unknown>;

    if (msg.type === 'text') {
      type = 'text';
      payload = { text: msg.text };
    } else if (msg.type === 'audio') {
      type = 'audio';
      payload = { media_path: msg.media_path };
    } else {
      type = msg.type;
      payload = { media_path: msg.media_path };
      if ('caption' in msg && msg.caption) payload.caption = msg.caption;
    }

    stepsToInsert.push({
      step_index: stepsToInsert.length,
      type,
      payload_json: payload,
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
      target_chat_id: null, // usa target do job
    });
  }

  // Cria o job
  const { data: job, error: jobErr } = await supabase
    .from('maturation_jobs')
    .insert({
      owner_user_id: adminProfile.id,
      plan_id: planId,
      master_instance_id: masterInstanceId,
      target_chat_id: targetChatId,
      status: 'running',
      progress_total: stepsToInsert.length,
      progress_done: 0,
      started_at: now.toISOString(),
    })
    .select('id')
    .single();

  if (jobErr || !job) {
    console.warn(`${LOG_AUTO} ${inst.instance_name}: erro ao criar job - ${jobErr?.message}`);
    return;
  }

  // Injeta job_id nos steps e salva
  const stepsWithJob = stepsToInsert.map((s) => ({ ...s, job_id: job.id }));
  await supabase.from('maturation_steps').insert(stepsWithJob);

  await supabase.from('virgin_maturation_logs').insert({
    evolution_instance_id: instanceId,
    event_type: 'warmup_job_created',
    message: `Job de warmup criado: ${stepsToInsert.length} mensagens para ${targetChatId}`,
    payload_json: { job_id: job.id, target: targetChatId, steps: stepsToInsert.length },
  }).then(() => {});

  logVerbose(`${LOG_AUTO} ${inst.instance_name}: job de warmup criado (${stepsToInsert.length} steps → ${targetChatId})`);
}

export type CatchUpResult = {
  sent: number;
  failed: number;
  /** Destino sem WhatsApp já conhecido — pulado sem chamar Evolution. */
  skipped: number;
  results: Array<{ step_index: number; status: 'sent' | 'failed' | 'skipped' | 'pending' }>;
};

/**
 * Processa em lote todos os steps atrasados (scheduled_at <= now) de um job.
 * Envia direto para a Evolution API. Retorna quantos foram enviados, falharam e o status por step.
 */
export async function runJobCatchUp(supabase: SupabaseClient, jobId: string): Promise<CatchUpResult> {
  const results: Array<{ step_index: number; status: 'sent' | 'failed' | 'skipped' | 'pending' }> = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const { data: job, error: jobErr } = await supabase
    .from('maturation_jobs')
    .select(`
      id,
      target_chat_id,
      master_instance_id,
      status,
      plan_id,
      campaign_id
    `)
    .eq('id', jobId)
    .single();

  if (jobErr || !job || job.status !== 'running') {
    logVerbose(`${LOG_MANUAL} runJobCatchUp job=${jobId} ignorado (não encontrado ou não running)`);
    return { sent: 0, failed: 0, skipped: 0, results: [] };
  }

  const pid = (job as { plan_id?: string }).plan_id;
  if (pid) {
    const { data: planRow } = await supabase.from('maturation_plans').select('is_active').eq('id', pid).maybeSingle();
    if (!planRow || planRow.is_active !== true) {
      const { data: labelRow } = await supabase
        .from('maturation_jobs')
        .select(`master_instances ( evolution_instances ( instance_name ) )`)
        .eq('id', jobId)
        .maybeSingle();
      const mi = (labelRow as { master_instances?: { evolution_instances?: { instance_name?: string } } })?.master_instances;
      const instanceLabel = mi?.evolution_instances?.instance_name ?? '—';
      await terminateMaturationJobsInfrastructureFailure(supabase, {
        triggerJobId: jobId,
        stepId: null,
        instanceName: instanceLabel,
        failReason: 'Plano de maturação inativo ou removido. Envios cancelados.',
        logLabel: 'Plano inativo (catch-up)',
        userTitle: '⛔ Plano de maturação inativo',
        userContent: 'O plano deste job não está mais ativo. A maturação foi encerrada.',
        errorDetail: 'maturation_plans.is_active = false',
      });
      return { sent: 0, failed: 0, skipped: 0, results: [] };
    }
  }

  logVerbose(`${LOG_MANUAL} runJobCatchUp job=${jobId} processando steps atrasados`);

  const { data: steps, error: stepsErr } = await supabase
    .from('maturation_steps')
    .select('id, job_id, step_index, type, payload_json, attempts, target_chat_id')
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('step_index', { ascending: true });

  if (stepsErr || !steps?.length) {
    return { sent: 0, failed: 0, skipped: 0, results: [] };
  }

  const { data: creds } = await supabase
    .from('master_instances')
    .select(`
      evolution_instances!inner (
        instance_name,
        evolution_apis!inner (
          base_url,
          api_key_global
        )
      )
    `)
    .eq('id', job.master_instance_id)
    .single();

  const ev = (creds as any)?.evolution_instances;
  const api = Array.isArray(ev?.evolution_apis) ? ev.evolution_apis[0] : ev?.evolution_apis;
  const instance_name = ev?.instance_name ?? '';
  const base_url = api?.base_url ?? '';
  const api_key = api?.api_key_global ?? '';
  if (!instance_name || !base_url || !api_key) {
    console.warn(`${LOG_PREFIX} runJobCatchUp - Credenciais não encontradas para job ${jobId}`);
    return { sent: 0, failed: 0, skipped: 0, results: [] };
  }

  // Process steps sequentially (Evolution API calls must be serial per instance)
  // but batch-fetch all statuses in one query after processing
  const enrichedSteps = steps.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    step_index: row.step_index,
    type: row.type,
    payload_json: row.payload_json || {},
    attempts: row.attempts || 0,
    instance_name,
    base_url,
    api_key,
    target_chat_id: (row.target_chat_id && String(row.target_chat_id).trim()) || job.target_chat_id || null,
    master_instance_id: job.master_instance_id,
  }));

  const campaignId = (job as { campaign_id?: string | null }).campaign_id;
  const catchUpScopeKey = maturationScopeKey(campaignId, jobId);
  const catchUpInvalidSet = await loadInvalidWhatsappDestKeysForScope(supabase, campaignId, jobId);
  const invalidWhatsappDestByScope = new Map<string, Set<string>>([[catchUpScopeKey, catchUpInvalidSet]]);

  for (const stepEnriched of enrichedSteps) {
    await processStep(supabase, stepEnriched, { invalidWhatsappDestByScope });
  }

  // Batch-fetch all step statuses in one query (avoids N+1 individual selects)
  const stepIds = steps.map((r) => r.id);
  const { data: updatedSteps } = await supabase
    .from('maturation_steps')
    .select('id, status')
    .in('id', stepIds);
  const statusById = new Map((updatedSteps || []).map((s) => [s.id, s.status]));

  for (const row of steps) {
    const rawStatus = statusById.get(row.id);
    const st: 'sent' | 'failed' | 'skipped' | 'pending' =
      rawStatus === 'sent'
        ? 'sent'
        : rawStatus === 'failed'
          ? 'failed'
          : rawStatus === 'skipped'
            ? 'skipped'
            : 'pending';
    results.push({ step_index: row.step_index, status: st });
    if (st === 'sent') sent++;
    else if (st === 'failed') failed++;
    else if (st === 'skipped') skipped++;
  }

  await updateJobProgress(supabase, jobId);
  logVerbose(`${LOG_MANUAL} runJobCatchUp job=${jobId} concluído: sent=${sent} failed=${failed} skipped=${skipped}`);
  return { sent, failed, skipped, results };
}

/**
 * Reseta steps travados em 'processing' por mais de STUCK_PROCESSING_TIMEOUT_MS de volta para 'pending'.
 * Isso ocorre quando o tick anterior reclamou os steps mas não terminou de processá-los (timeout).
 */
async function recoverStuckSteps(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_TIMEOUT_MS).toISOString();
  const { data, error } = await supabase
    .from('maturation_steps')
    .update({ status: 'pending', locked_at: null, locked_by: null })
    .eq('status', 'processing')
    .lt('locked_at', cutoff)
    .select('id');
  if (error) {
    console.warn(`${LOG_MANUAL} Erro ao recuperar steps travados: ${error.message}`);
    return 0;
  }
  const count = data?.length ?? 0;
  if (count > 0) logVerbose(`${LOG_MANUAL} ${count} step(s) travados em 'processing' resetados para 'pending'`);
  return count;
}

// ─── Mesh cycles ─────────────────────────────────────────────────────────────
/** Logs do maturador mesh (campanhas contínuas auto-maturadas). */
const LOG_MESH = '[MATURADOR-MESH]';
// Intervalo entre ciclos mesh: 1–3 min aleatório.
// Separado do warmup de 15 min para instâncias novas (SEND_DELAY_MS no runMeshCycle).
const MESH_CYCLE_INTERVAL_MIN_SEC = 3 * 60;   // 3 min
const MESH_CYCLE_INTERVAL_MAX_SEC = 8 * 60;   // 8 min
const MESH_MAX_SENDERS_PER_CYCLE = 5;
const MESH_MIN_SENDERS_PER_CYCLE = 1;

async function loadMeshMessagePool(
  supabase: SupabaseClient,
  meshCycleCount: number | null | undefined
): Promise<{ pool: Array<{ type: string; payload: Record<string, unknown> }>; planIndex: number; planCount: number }> {
  const plans = await loadVirginMessagePlansFromDb(supabase);
  if (plans.length === 0) {
    const pool = VIRGIN_MESSAGES_FALLBACK.map((m) => ({
      type: m.type,
      payload: m.type === 'text' ? { text: (m as { text: string }).text } : {},
    }));
    return { pool, planIndex: 0, planCount: 1 };
  }
  const planCount = plans.length;
  let planIndex = meshMessagePlanIndex(meshCycleCount, planCount);
  let msgs = plans[planIndex];
  if (!msgs || msgs.length === 0) {
    const first = plans.find((p) => p.length > 0);
    if (first) {
      planIndex = plans.indexOf(first);
      msgs = first;
    }
  }
  if (!msgs || msgs.length === 0) {
    const pool = VIRGIN_MESSAGES_FALLBACK.map((m) => ({
      type: m.type,
      payload: m.type === 'text' ? { text: (m as { text: string }).text } : {},
    }));
    return { pool, planIndex: 0, planCount: Math.max(1, planCount) };
  }
  return { pool: virginPlanToMeshPool(msgs), planIndex, planCount };
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizePhoneToJid(phone: string): string {
  const t = String(phone || '').trim();
  if (!t) return '';
  if (t.includes('@')) return t;
  return `${t.replace(/\D/g, '')}@s.whatsapp.net`;
}

type MeshController = {
  id: string;
  owner_user_id: string;
  campaign_id: string | null;
  mesh_cycle_interval_sec: number | null;
  mesh_cycle_count: number | null;
  mesh_last_sender_master_ids: string[] | null;
};

type MeshParticipant = {
  jobId: string;
  masterInstanceId: string;
  instanceName: string;
  jid: string;
  startedAt: string | null; // quando o job entrou no ciclo
};

const GRUPO_MATURACAO_ID = '120363428157075135@g.us';
const LOG_GRUPO = '[GRUPO-MAT]';

/** Linhas individuais de "João de Santo Cristo" — Legião Urbana. Cada linha = 1 mensagem. */
const GRUPO_LINES: string[] = [
  'Não tinha medo o tal João de Santo Cristo',
  'Era o que todos diziam quando ele se perdeu',
  'Deixou pra trás todo o marasmo da fazenda',
  'Só pra sentir no seu sangue o ódio que Jesus lhe deu',
  'Quando criança só pensava em ser bandido',
  'Ainda mais quando com um tiro de soldado o pai morreu',
  'Era o terror da cercania onde morava',
  'E na escola até o professor com ele aprendeu',
  'Ia pra igreja só pra roubar o dinheiro',
  'Que as velhinhas colocavam na caixinha do altar',
  'Sentia mesmo que era mesmo diferente',
  'Sentia que aquilo ali não era o seu lugar',
  'Ele queria sair para ver o mar',
  'E as coisas que ele via na televisão',
  'Juntou dinheiro para poder viajar',
  'De escolha própria, escolheu a solidão',
  'Comia todas as menininhas da cidade',
  'De tanto brincar de médico, aos doze era professor',
  'Aos quinze, foi mandado pro reformatório',
  'Onde aumentou seu ódio diante de tanto terror',
  'Não entendia como a vida funcionava',
  'Discriminação por causa da sua classe e sua cor',
  'Ficou cansado de tentar achar resposta',
  'E comprou uma passagem, foi direto a Salvador',
  'E lá chegando foi tomar um cafezinho',
  'E encontrou um boiadeiro com quem foi falar',
  'E o boiadeiro tinha uma passagem e ia perder a viagem',
  'Mas João foi lhe salvar',
  'Dizia ele, estou indo pra Brasília',
  'Neste país, lugar melhor não há',
  'To precisando visitar a minha filha',
  'Eu fico aqui e você vai no meu lugar',
  'E João aceitou sua proposta',
  'E num ônibus entrou no Planalto Central',
  'Ele ficou bestificado com a cidade',
  'Saindo da rodoviária, viu as luzes de Natal',
  'Meu Deus, mais que cidade linda',
  'No Ano Novo eu começo a trabalhar',
  'Cortar madeira, aprendiz de carpinteiro',
  'Ganhava cem mil por mês em Taguatinga',
  'Na sexta-feira ia pra zona da cidade',
  'Gastar todo o seu dinheiro de rapaz trabalhador',
  'E conhecia muita gente interessante',
  'Até um neto bastardo do seu bisavô',
  'Um peruano que vivia na Bolívia',
  'E muitas coisas trazia de lá',
  'Seu nome era Pablo e ele dizia',
  'Que um negócio ele ia começar',
  'E o Santo Cristo até a morte trabalhava',
  'Mas o dinheiro não dava pra ele se alimentar',
  'E ouvia às sete horas o noticiário',
  'Que sempre dizia que o Seu ministro ia ajudar',
  'Mas ele não queria mais conversa',
  'E decidiu que, como Pablo, ele ia se virar',
  'Elaborou mais uma vez seu plano santo',
  'E sem ser crucificado, a plantação foi começar',
  'Logo logo os maluco da cidade souberam da novidade',
  'Tem bagulho bom aí!',
  'E João de Santo Cristo ficou rico',
  'E acabou com todos os traficantes dali',
  'Fez amigos, frequentava a Asa Norte',
  'E ia pra festa de rock, pra se libertar',
  'De repente sob uma má influência dos boyzinho da cidade começou a roubar',
  'Já no primeiro roubo, ele dançou',
  'E pro inferno ele foi pela primeira vez',
  'Violência e estupro do seu corpo',
  'Vocês vão ver, eu vou pegar vocês',
  'Agora o Santo Cristo era bandido',
  'Destemido e temido no Distrito Federal',
  'Não tinha nenhum medo de polícia',
  'Capitão ou traficante, playboy ou general',
  'Foi quando conheceu uma menina',
  'E de todos os seus pecados ele se arrependeu',
  'Maria Lúcia era uma menina linda',
  'E o coração dele pra ela, o Santo Cristo prometeu',
  'Ele dizia que queria se casar',
  'E carpinteiro ele voltou a ser',
  'Maria Lúcia, pra sempre vou te amar',
  'E um filho com você eu quero ter',
  'O tempo passa e um dia vem na porta',
  'Um senhor de alta classe com dinheiro na mão',
  'E ele faz uma proposta indecorosa',
  'E diz que espera uma resposta, uma resposta do João',
  'Não boto bomba em banca de jornal',
  'Nem em colégio de criança, isso eu não faço não',
  'E não protejo general de dez estrelas',
  'Que fica atrás da mesa com o cu na mão',
  'E é melhor o senhor sair da minha casa',
  'Nunca brinque com um Peixes de ascendente em Escorpião',
  'Mas antes de sair, com ódio no olhar, o velho disse',
  'Você perdeu sua vida, meu irmão',
  'Você perdeu a sua vida, meu irmão',
  'Essas palavras vão entrar no coração',
  'Eu vou sofrer as consequências como um cão',
  'Não é que o Santo Cristo estava certo',
  'Seu futuro era incerto e ele não foi trabalhar',
  'Se embebedou e no meio da bebedeira',
  'Descobriu que tinha outro trabalhando em seu lugar',
  'Falou com Pablo que queria um parceiro',
  'E também tinha dinheiro e queria se armar',
  'Pablo trazia o contrabando da Bolívia',
  'E Santo Cristo revendia em Planaltina',
  'Mas acontece que um tal de Jeremias',
  'Traficante de renome, apareceu por lá',
  'Ficou sabendo dos planos de Santo Cristo',
  'E decidiu que com o João ele ia acabar',
  'Mas Pablo trouxe uma Winchester 22',
  'E Santo Cristo já sabia atirar',
  'E decidiu usar a arma só depois',
  'Que Jeremias começasse a brigar',
  'Jeremias, maconheiro sem-vergonha',
  'Organizou a Rockonha e fez todo mundo dançar',
  'Desvirginava mocinhas inocentes',
  'Se dizia crente, não sabia rezar',
  'E Santo Cristo há muito não ia pra casa',
  'E a saudade começou a apertar',
  'Eu vou me embora, eu vou ver Maria Lúcia',
  'Já tá em tempo de a gente se casar',
  'Chegando em casa, então, ele chorou',
  'E pro inferno ele foi pela segunda vez',
  'Com Maria Lúcia o Jeremias se casou',
  'E um filho nela ele fez',
  'Santo Cristo era só ódio por dentro',
  'E então o Jeremias pra um duelo ele chamou',
  'Amanhã às duas horas na Ceilândia',
  'Em frente ao Lote 14, e é pra lá que eu vou',
  'E você pode escolher as suas armas',
  'Que eu acabo mesmo com você, seu porco traidor',
  'E mato também Maria Lúcia',
  'Aquela menina falsa pra quem jurei o meu amor',
  'E o Santo Cristo não sabia o que fazer',
  'Quando viu o repórter da televisão',
  'Que deu notícia do duelo na TV',
  'Dizendo a hora e o local e a razão',
  'No sábado então, às duas horas',
  'Todo o povo sem demora foi lá só para assistir',
  'Um homem que atirava pelas costas',
  'E acertou o Santo Cristo e começou a sorrir',
  'Sentindo o sangue na garganta',
  'João olhou pras bandeirinhas e pro povo a aplaudir',
  'E olhou pro sorveteiro e pras câmeras',
  'E a gente da TV que filmava tudo ali',
  'E se lembrou de quando era uma criança',
  'E de tudo o que vivera até ali',
  'E decidiu entrar de vez naquela dança',
  'Se a via-crucis virou circo, estou aqui',
  'E nisso o sol cegou seus olhos',
  'E então Maria Lúcia ele reconheceu',
  'Ela trazia a Winchester 22',
  'A arma que seu primo Pablo lhe deu',
  'Jeremias, eu sou homem, coisa que você não é',
  'E não atiro pelas costas não',
  'Olha pra cá filha da puta, sem-vergonha',
  'Dá uma olhada no meu sangue e vem sentir o teu perdão',
  'E Santo Cristo com a Winchester 22',
  'Deu cinco tiros no bandido traidor',
  'Maria Lúcia se arrependeu depois',
  'E morreu junto com João, seu protetor',
  'E o povo declarava que João de Santo Cristo',
  'Era santo porque sabia morrer',
  'E a alta burguesia da cidade',
  'Não acreditou na história que eles viram na TV',
  'E João não conseguiu o que queria',
  'Quando veio pra Brasília, com o diabo ter',
  'Ele queria era falar pro presidente',
  'Pra ajudar toda essa gente que só faz sofrer',
];

/**
 * Fase extra: TODAS as master_instances conectadas enviam 1-5 estrofes de "João de Santo Cristo"
 * de partes aleatórias diferentes do texto ao grupo de maturação.
 * Processa APENAS 1 instância por tick para não consumir o orçamento da maturação mútua.
 */
export async function runGroupMessaging(supabase: SupabaseClient): Promise<number> {
  // Só envia ao grupo se houver campanha mesh ativa (running).
  // Quando o mesh está pausado, o envio ao grupo também é suspenso.
  const { data: runningCtrl } = await supabase
    .from('maturation_jobs')
    .select('id')
    .eq('mesh_is_controller', true)
    .eq('status', 'running')
    .limit(1)
    .maybeSingle();

  if (!runningCtrl) {
    logVerbose(`${LOG_GRUPO} Mesh pausado ou sem campanha ativa — envio ao grupo suspenso`);
    return 0;
  }

  const now = new Date();

  const { data: rows, error } = await supabase
    .from('master_instances')
    .select(`
      id,
      group_msg_next_at,
      group_msg_strophe_idx,
      evolution_instances:evolution_instance_id (
        id,
        instance_name,
        status,
        maturation_type,
        evolution_apis:evolution_api_id ( base_url, api_key_global )
      )
    `)
    .eq('is_active', true)
    .order('group_msg_next_at', { ascending: true, nullsFirst: true });

  if (error) {
    console.warn(`${LOG_GRUPO} Erro ao listar instâncias: ${error.message}`);
    return 0;
  }

  if (!rows || rows.length === 0) return 0;

  let totalSent = 0;

  for (const row of rows as any[]) {
    // Primeira vez: agenda com delay escalonado curto (0-30s) para não enviar tudo ao mesmo tempo
    if (!row.group_msg_next_at) {
      const staggerMs = Math.random() * 30_000;
      await supabase
        .from('master_instances')
        .update({ group_msg_next_at: new Date(Date.now() + staggerMs).toISOString() })
        .eq('id', row.id);
      continue;
    }

    if (new Date(row.group_msg_next_at).getTime() > now.getTime()) continue;

    const ei = Array.isArray(row.evolution_instances) ? row.evolution_instances[0] : row.evolution_instances;
    // Apenas instâncias virgem enviam ao grupo de maturação
    if (ei?.maturation_type !== 'virgem') continue;
    const api = Array.isArray(ei?.evolution_apis) ? ei.evolution_apis[0] : ei?.evolution_apis;
    const instanceName: string = ei?.instance_name ?? '';
    const baseUrl: string = api?.base_url ?? '';
    const apiKey: string = api?.api_key_global ?? '';
    const instanceStatus: string = ei?.status ?? '';

    if (!instanceName || !baseUrl || !apiKey) continue;

    // Desconectada: reagenda em 1 min sem enviar — continua para a próxima instância do ciclo
    if (!evolutionMaturationDbStatusIsConnected(instanceStatus)) {
      await supabase.from('master_instances')
        .update({ group_msg_next_at: new Date(Date.now() + 60_000).toISOString() })
        .eq('id', row.id);
      logVerbose(`${LOG_GRUPO} ⏭ ${instanceName} desconectada (status=${instanceStatus}) — próxima tentativa em 60s`);
      continue;
    }

    // Envia SOMENTE 1 linha por vez. Cada instância tem seu próprio ponteiro
    // (group_msg_strophe_idx) que avança sequencialmente para não repetir.
    // Na primeira vez, sorteia uma posição inicial aleatória para que cada
    // instância comece em um ponto diferente da letra.
    const total = GRUPO_LINES.length;
    const currentIdx = typeof row.group_msg_strophe_idx === 'number'
      ? ((row.group_msg_strophe_idx % total) + total) % total
      : Math.floor(Math.random() * total);

    const evoId = ei?.id as string | undefined;

    let sentCount = 0;
    let notInGroup = false;
    const result = await sendText({
      baseUrl, instanceName, apiKey,
      number: GRUPO_MATURACAO_ID,
      text: GRUPO_LINES[currentIdx],
    });
    if (result.success) {
      sentCount = 1;
    } else if (result.httpStatus === 400) {
      // Connection Closed = instância desconectou → marca no banco e sai
      if (isConnectionClosedError({ error: result.error, httpStatus: result.httpStatus })) {
        if (evoId) {
          await maybeMarkEvolutionInstanceDisconnected(supabase, evoId, result.error, 'group-messaging');
        }
        await supabase.from('master_instances')
          .update({ group_msg_next_at: new Date(Date.now() + 60_000).toISOString() })
          .eq('id', row.id);
        console.warn(`${LOG_GRUPO} ⚠️ ${instanceName} desconectada (Connection Closed) — marcada no banco`);
        return 0;
      }
      notInGroup = true;
    }

    if (notInGroup && sentCount === 0) {
      await supabase.from('master_instances')
        .update({ group_msg_next_at: new Date(Date.now() + 600_000).toISOString() })
        .eq('id', row.id);
      console.warn(`${LOG_GRUPO} ⚠️ ${instanceName} fora do grupo (HTTP 400) — próxima tentativa em 10min`);
      // Processa apenas 1 instância por ciclo — sai do loop
      return 0;
    }

    const nextIdx = (currentIdx + 1) % total;
    const delayMs = (60 + Math.random() * 240) * 1000; // 1-5 minutos por instância

    console.log(`${LOG_GRUPO} ✅ ${instanceName} 1 linha (idx ${currentIdx}/${total}) → grupo (próximo ${Math.round(delayMs / 1000)}s)`);

    await supabase.from('master_instances').update({
      group_msg_next_at: new Date(Date.now() + delayMs).toISOString(),
      group_msg_strophe_idx: nextIdx,
    }).eq('id', row.id);

    // 1 instância e 1 linha por ciclo — evita flood no grupo
    return sentCount;
  }

  return totalSent;
}

async function processMeshCycles(supabase: SupabaseClient): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: controllers, error } = await supabase
    .from('maturation_jobs')
    .select(
      'id, owner_user_id, campaign_id, mesh_cycle_interval_sec, mesh_cycle_count, mesh_last_sender_master_ids'
    )
    .eq('mesh_is_controller', true)
    .eq('status', 'running')
    .lte('mesh_next_cycle_at', nowIso)
    .limit(50);

  if (error) {
    console.warn(`${LOG_MESH} Erro ao buscar controllers: ${error.message}`);
    return 0;
  }
  if (!controllers || controllers.length === 0) return 0;

  let cycledCount = 0;
  for (const ctrl of controllers as MeshController[]) {
    try {
      // Auto-enrollment ANTES do ciclo: descobre instâncias novas/que voltaram a ficar elegíveis
      // e adiciona como participantes automaticamente. Garante que a "rede" esteja sempre atualizada.
      await autoEnrollMeshParticipants(supabase, ctrl);
      const advanced = await runMeshCycle(supabase, ctrl, now);
      if (advanced) cycledCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${LOG_MESH} Erro no ciclo campaign=${ctrl.campaign_id}: ${msg}`);
    }
  }
  return cycledCount;
}

/**
 * Auto-inscreve no mesh qualquer evolution_instance ativa, com telefone, não bloqueada,
 * que ainda não esteja participando da campanha. Roda a cada ciclo, então:
 * - Instância nova criada → entra no próximo ciclo
 * - Instância que estava offline e voltou → continua participando (já tinha job; não precisa re-add)
 * - Instância nova de outro usuário → também entra (mesh é singleton global)
 */
async function autoEnrollMeshParticipants(
  supabase: SupabaseClient,
  controller: MeshController
): Promise<void> {
  if (!controller.campaign_id) return;

  // Busca apenas evolution_instances do tipo 'virgem' — maturadas não participam do mesh.
  const { data: eligibleRows, error: eligErr } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, phone_number')
    .eq('is_active', true)
    .eq('maturation_type', 'virgem')
    .eq('blocked_from_maturation', false)
    .not('phone_number', 'is', null);

  if (eligErr) {
    console.warn(`${LOG_MESH} autoEnroll: erro listando elegíveis: ${eligErr.message}`);
    return;
  }
  const eligible = (eligibleRows || []).filter(
    (r: any) => r.id && r.phone_number && String(r.phone_number).trim()
  );
  if (eligible.length === 0) return;

  // Quem já participa ATIVAMENTE (running ou paused).
  // Jobs abortados/failed/finished não contam: a instância pode se re-inscrever.
  const { data: existingJobs } = await supabase
    .from('maturation_jobs')
    .select('id, master_instance_id, master_instances!inner(evolution_instance_id)')
    .eq('campaign_id', controller.campaign_id)
    .in('status', ['running', 'paused']);

  const enrolledEvoIds = new Set<string>();
  for (const j of (existingJobs || []) as any[]) {
    const mi = Array.isArray(j.master_instances) ? j.master_instances[0] : j.master_instances;
    if (mi?.evolution_instance_id) enrolledEvoIds.add(String(mi.evolution_instance_id));
  }

  const newRows = eligible.filter((r: any) => !enrolledEvoIds.has(String(r.id)));
  if (newRows.length === 0) return;

  for (const r of newRows as any[]) {
    // Garante master_instances row (cria se não existe). Sem scope: o tick roda como service_role.
    const evoId = r.id as string;
    const { data: existingMi } = await supabase
      .from('master_instances')
      .select('id')
      .eq('evolution_instance_id', evoId)
      .maybeSingle();

    let masterInstanceId: string;
    if (existingMi?.id) {
      masterInstanceId = existingMi.id;
    } else {
      const { data: ins, error: insErr } = await supabase
        .from('master_instances')
        .insert({ evolution_instance_id: evoId, is_active: true, is_locked: false })
        .select('id')
        .single();
      if (insErr || !ins) {
        console.warn(
          `${LOG_MESH} autoEnroll: erro criando master_instance evo=${evoId}: ${insErr?.message}`
        );
        continue;
      }
      masterInstanceId = ins.id;
    }

    const enrolledAt = new Date().toISOString();
    const { error: jobErr } = await supabase.from('maturation_jobs').insert({
      owner_user_id: controller.owner_user_id, // herda do controller (background, sem usuário ativo)
      plan_id: VIRGIN_AUTO_MATURATION_PLAN_ID,
      master_instance_id: masterInstanceId,
      target_chat_id: '',
      campaign_id: controller.campaign_id,
      status: 'running',
      progress_total: 0,
      progress_done: 0,
      // started_at marca o início do warmup. Instância só poderá ENVIAR após 15 min.
      // Até lá, participa apenas como recipient (recebe mensagens das demais) e envia no grupo.
      started_at: enrolledAt,
      mesh_is_controller: false,
    });
    if (jobErr) {
      console.warn(
        `${LOG_MESH} autoEnroll: erro criando job participante evo=${evoId}: ${jobErr.message}`
      );
      continue;
    }
    console.log(
      `${LOG_MESH} autoEnroll: ${r.instance_name} (evo=${evoId}) entrou no ciclo — só RECEBE mensagens por 15 min (warmup até ${new Date(new Date(enrolledAt).getTime() + 15 * 60 * 1000).toISOString()})`
    );
  }

  await createMessage(supabase, {
    jobId: controller.id,
    direction: 'system',
    type: 'info',
    title: 'Auto-enrollment',
    content: `${newRows.length} instância(s) entraram automaticamente na rede: ${(newRows as any[])
      .map((r) => r.instance_name)
      .join(', ')}.`,
    status: 'info',
  });
  console.log(
    `${LOG_MESH} autoEnroll campaign=${controller.campaign_id}: +${newRows.length} instância(s)`
  );
}

async function runMeshCycle(
  supabase: SupabaseClient,
  controller: MeshController,
  now: Date
): Promise<boolean> {
  // Intervalo aleatório a cada ciclo: 5–15 min (independente do valor configurado no banco)
  const intervalSec =
    MESH_CYCLE_INTERVAL_MIN_SEC +
    Math.floor(Math.random() * (MESH_CYCLE_INTERVAL_MAX_SEC - MESH_CYCLE_INTERVAL_MIN_SEC + 1));
  const nextCycleAt = new Date(now.getTime() + intervalSec * 1000).toISOString();

  const { data: participantJobs, error: pErr } = await supabase
    .from('maturation_jobs')
    .select(
      `id, master_instance_id, started_at,
       master_instances!inner (
         id, is_active,
         evolution_instances!inner ( id, instance_name, phone_number, status, maturation_type )
       )`
    )
    .eq('campaign_id', controller.campaign_id)
    .eq('status', 'running');

  if (pErr || !participantJobs) {
    console.warn(`${LOG_MESH} Erro buscar participantes campaign=${controller.campaign_id}`);
    await supabase
      .from('maturation_jobs')
      .update({ mesh_next_cycle_at: nextCycleAt, updated_at: now.toISOString() })
      .eq('id', controller.id);
    return false;
  }

  // ─── REGRAS DE PARTICIPAÇÃO NO CICLO MESH ────────────────────────────────
  // 1. APENAS instâncias do tipo 'virgem' participam. Instâncias 'maturado' são EXCLUÍDAS.
  // 2. Instâncias novas RECEBEM mensagens desde o 1º ciclo (activeRecipients = eligible).
  // 3. Instâncias novas NÃO ENVIAM mensagens até completar 15 min de warmup (SEND_DELAY_MS).
  //    Instância sem started_at é sempre tratada como nova — jamais envia.
  // 4. Sem fallback: se não há senders maduros, o ciclo pula sem enviar nada.
  // ─────────────────────────────────────────────────────────────────────────
  const SEND_DELAY_MS = 15 * 60 * 1000; // 15 min de warmup antes de poder enviar

  const eligible: MeshParticipant[] = [];
  for (const j of participantJobs as any[]) {
    const mi = Array.isArray(j.master_instances) ? j.master_instances[0] : j.master_instances;
    if (!mi?.is_active) continue;
    const ei = Array.isArray(mi.evolution_instances) ? mi.evolution_instances[0] : mi.evolution_instances;
    if (!ei?.phone_number) continue;
    // REGRA 1: apenas instâncias virgem entram no pool. Maturadas são ignoradas.
    if (ei.maturation_type !== 'virgem') continue;
    if (!evolutionMaturationDbStatusIsConnected(ei.status)) continue;
    const jid = normalizePhoneToJid(String(ei.phone_number));
    if (!jid) continue;
    eligible.push({
      jobId: j.id,
      masterInstanceId: j.master_instance_id,
      instanceName: String(ei.instance_name ?? ''),
      jid,
      startedAt: j.started_at ?? null,
    });
  }

  if (eligible.length < 2) {
    await supabase
      .from('maturation_jobs')
      .update({ mesh_next_cycle_at: nextCycleAt, updated_at: now.toISOString() })
      .eq('id', controller.id);
    const totalJobs = (participantJobs as any[]).length;
    console.warn(
      `${LOG_MESH} ⚠️ campaign=${controller.campaign_id}: ${eligible.length} instância(s) conectada(s) de ${totalJobs} job(s) running — mínimo 2 para ciclo. Verifique se as instâncias estão conectadas e são do tipo virgem.`
    );
    return false;
  }

  const { pool, planIndex, planCount } = await loadMeshMessagePool(supabase, controller.mesh_cycle_count);
  if (pool.length === 0) {
    await supabase
      .from('maturation_jobs')
      .update({ mesh_next_cycle_at: nextCycleAt, updated_at: now.toISOString() })
      .eq('id', controller.id);
    console.warn(`${LOG_MESH} campaign=${controller.campaign_id}: pool de mensagens vazio, ciclo pulado`);
    return false;
  }

  console.log(
    `${LOG_MESH} ciclo usa plano de mensagens #${planIndex + 1}/${planCount} (mesh_cycle_count=${controller.mesh_cycle_count ?? 0})`
  );
  const meshInvalidDestKeys = await loadInvalidWhatsappDestKeysForScope(
    supabase,
    controller.campaign_id,
    controller.id
  );

  const nowMs = now.getTime();

  // REGRA 2 + 3: senders = apenas quem tem started_at E completou 15 min de warmup.
  // Quem não tem started_at ou ainda está em warmup fica APENAS como recipient.
  const activeSenders = eligible.filter((p) => {
    if (!p.startedAt) return false; // nova (sem started_at) → só recebe, nunca envia
    return nowMs - new Date(p.startedAt).getTime() >= SEND_DELAY_MS;
  });

  // REGRA 2: todos no pool recebem mensagens desde o 1º ciclo (sem espera).
  const activeRecipients = eligible;

  const warmingUp = eligible.length - activeSenders.length;
  if (warmingUp > 0) {
    logVerbose(
      `${LOG_MESH} campaign=${controller.campaign_id}: ${activeSenders.length} sender(s) prontos, ${warmingUp} em warmup (só recebe por mais alguns min)`
    );
  }

  // Equidade: prioriza quem NÃO foi sender no ciclo anterior
  const lastSenders = new Set<string>(controller.mesh_last_sender_master_ids || []);
  const notLast = activeSenders.filter((p) => !lastSenders.has(p.masterInstanceId));
  const wereLast = activeSenders.filter((p) => lastSenders.has(p.masterInstanceId));

  const desiredCount =
    MESH_MIN_SENDERS_PER_CYCLE + Math.floor(Math.random() * MESH_MAX_SENDERS_PER_CYCLE);
  const targetCount = Math.min(MESH_MAX_SENDERS_PER_CYCLE, activeSenders.length, desiredCount);

  const senders: MeshParticipant[] = [];
  for (const p of shuffleArray(notLast)) {
    if (senders.length >= targetCount) break;
    senders.push(p);
  }
  if (senders.length < targetCount) {
    for (const p of shuffleArray(wereLast)) {
      if (senders.length >= targetCount) break;
      senders.push(p);
    }
  }

  if (senders.length === 0) {
    await supabase
      .from('maturation_jobs')
      .update({ mesh_next_cycle_at: nextCycleAt, updated_at: now.toISOString() })
      .eq('id', controller.id);
    logVerbose(
      `${LOG_MESH} campaign=${controller.campaign_id}: nenhum sender maduro ainda (${eligible.length} instância(s) em warmup < 15 min) — aguardando próximo ciclo`
    );
    return false;
  }

  // Próximo step_index por job (UNIQUE(job_id, step_index))
  const senderJobIds = senders.map((s) => s.jobId);
  const maxIndices = new Map<string, number>();
  const { data: maxRows } = await supabase
    .from('maturation_steps')
    .select('job_id, step_index')
    .in('job_id', senderJobIds)
    .order('step_index', { ascending: false });
  for (const r of (maxRows || []) as any[]) {
    const cur = maxIndices.get(r.job_id);
    if (cur == null || r.step_index > cur) maxIndices.set(r.job_id, r.step_index);
  }

  const stepsToInsert: Array<{
    job_id: string;
    step_index: number;
    type: string;
    payload_json: Record<string, unknown>;
    scheduled_at: string;
    status: string;
    target_chat_id: string;
    sender_master_instance_id: string;
  }> = [];

  for (const sender of senders) {
    const recipients = activeRecipients.filter((p) => p.masterInstanceId !== sender.masterInstanceId);
    let nextIdx = (maxIndices.get(sender.jobId) ?? -1) + 1;
    // Cada mensagem do mesmo sender é espaçada 30s–5min em relação à anterior.
    // Acumulado por sender: as mensagens saem em fila, não em rajada.
    let senderOffsetMs = 0;
    for (const r of recipients) {
      if (meshInvalidDestKeys.has(normalizeMaturationDestKey(r.jid))) continue;
      senderOffsetMs += 300_000 + Math.floor(Math.random() * 600_001); // 5min a 15min
      const scheduledAt = new Date(now.getTime() + senderOffsetMs).toISOString();
      const msg = pool[Math.floor(Math.random() * pool.length)];
      stepsToInsert.push({
        job_id: sender.jobId,
        step_index: nextIdx++,
        type: msg.type,
        payload_json: msg.payload,
        scheduled_at: scheduledAt,
        status: 'pending',
        target_chat_id: r.jid,
        sender_master_instance_id: sender.masterInstanceId,
      });
    }
  }

  if (stepsToInsert.length === 0) {
    await supabase
      .from('maturation_jobs')
      .update({ mesh_next_cycle_at: nextCycleAt, updated_at: now.toISOString() })
      .eq('id', controller.id);
    return false;
  }

  console.log(
    `${LOG_MESH} ciclo: ${senders.length} remetente(s) [${senders.map((s) => s.instanceName).join(', ')}] → ${activeRecipients.length} destinatário(s) = ${stepsToInsert.length} step(s)`
  );
  const { error: insErr } = await supabase.from('maturation_steps').insert(stepsToInsert);
  if (insErr) {
    // Duplicate key = outro processo já inseriu este ciclo (PM2 cluster) — avança o controller normalmente
    if (!insErr.message?.includes('duplicate key')) {
      console.warn(`${LOG_MESH} Erro inserindo steps campaign=${controller.campaign_id}: ${insErr.message}`);
      return false;
    }
    // duplicata: não reinsere, mas avança o ciclo para evitar loop infinito
  }

  // Atualiza progress_total dos jobs senders
  const recipientsCount = activeRecipients.length;
  for (const sender of senders) {
    const { data: cur } = await supabase
      .from('maturation_jobs')
      .select('progress_total')
      .eq('id', sender.jobId)
      .maybeSingle();
    const total = ((cur as any)?.progress_total ?? 0) + recipientsCount;
    await supabase.from('maturation_jobs').update({ progress_total: total }).eq('id', sender.jobId);
  }

  // Atualiza controller
  const newCycleCount = (controller.mesh_cycle_count || 0) + 1;
  await supabase
    .from('maturation_jobs')
    .update({
      mesh_cycle_count: newCycleCount,
      mesh_last_sender_master_ids: senders.map((s) => s.masterInstanceId),
      mesh_next_cycle_at: nextCycleAt,
      updated_at: now.toISOString(),
    })
    .eq('id', controller.id);

  await createMessage(supabase, {
    jobId: controller.id,
    direction: 'system',
    type: 'info',
    title: `Ciclo mesh #${newCycleCount}`,
    content: `${senders.length} remetente(s): ${senders
      .map((s) => s.instanceName)
      .join(', ')}. ${stepsToInsert.length} mensagem(s) agendada(s).`,
    status: 'info',
  });

  console.log(
    `${LOG_MESH} ✅ ciclo #${newCycleCount} campaign=${controller.campaign_id}: ${senders.length} sender(s) × ${recipientsCount} destinatário(s) = ${stepsToInsert.length} step(s) | próximo em ${intervalSec}s (${nextCycleAt})`
  );
  return true;
}

// Mutex global: impede execuções simultâneas de runMaturationTick no mesmo processo Node
// (protege contra: instrumentation timer + process-now + cron-tick + mesh after() rodando juntos)
let _tickMutex = false;

export async function runMaturationTick(supabase: SupabaseClient): Promise<any> {
  if (_tickMutex) {
    console.warn('[MATURATION] runMaturationTick já está rodando — tick ignorado para evitar duplicação');
    return { processed: 0, hasMorePending: false, jobs: [], skipped: true };
  }
  _tickMutex = true;
  try {
  const startTime = Date.now();
  /**
   * Orçamento total do tick. O cron-tick tem maxDuration=55s; usamos 50s para processamento
   * e deixamos 5s de margem para overhead de rede/DB.
   * BUG FIX: antes estava 20000ms, que é menor que FETCH_TIMEOUT_MS (12000) + overhead,
   * fazendo o loop nunca processar nenhum step.
   */
  const MAX_RUNTIME_MS = 50000; // 50 segundos
  // Reserva de tempo por step: FETCH_TIMEOUT + 2s de overhead
  const STEP_TIME_BUDGET_MS = FETCH_TIMEOUT_MS + 2000; // 14s por step
  let totalProcessed = 0;
  /**
   * true quando o loop saiu por limite de tempo (não por falta de steps).
   * Indica que há mais steps pendentes para processar — o caller pode encadear outro tick.
   */
  let hasMorePending = false;
  const processedJobIds = new Set<string>();

  logVerbose(`${LOG_PREFIX} ========== Tick Maturador ==========`);

  await reconcileOrphanedMasterInstanceLocks(supabase);

  // Fase 0: Recuperar steps travados em 'processing' de ticks anteriores
  await recoverStuckSteps(supabase);

  // Garante o plano virgem ANTES de failRunningMaturationJobsWithInactivePlans.
  // Se o plano não existir ou estiver inativo, aquela função mataria todos os
  // participant jobs do mesh a cada tick, impedindo a maturação mútua.
  await ensureMeshVirginPlanActive(supabase);

  await failRunningMaturationJobsWithInactivePlans(supabase);

  // Fase 0.5: Mesh — injeta steps de ciclos vencidos antes do claim da Fase 1
  logVerbose(`${LOG_MESH} Fase mesh: ciclos contínuos`);
  const meshCyclesAdvanced = await processMeshCycles(supabase);
  if (meshCyclesAdvanced > 0) {
    logVerbose(`${LOG_MESH} ${meshCyclesAdvanced} ciclo(s) mesh avançado(s) neste tick`);
  }

  logVerbose(`${LOG_MANUAL} Fase 1: Maturador (manual) - jobs com steps agendados`);

  const invalidWhatsappDestByScope = await loadInvalidWhatsappDestinationMapForRunningJobs(supabase);

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed + STEP_TIME_BUDGET_MS > MAX_RUNTIME_MS) {
      logVerbose(`${LOG_MANUAL} Orçamento de tempo esgotado (${elapsed}ms/${MAX_RUNTIME_MS}ms), encerrando tick`);
      hasMorePending = true; // Pode haver mais steps — sinaliza para encadeamento
      break;
    }

    const { data: steps, error } = await supabase.rpc('claim_maturation_steps', { claim_limit: CLAIM_LIMIT });
    if (error) {
      console.warn(`${LOG_MANUAL} Erro ao reivindicar steps: ${error.message}`);
      break;
    }
    if (!steps || steps.length === 0) {
      /**
       * Nenhum step é devido AGORA. Verifica se há steps futuros de jobs running
       * que vencem dentro do nosso orçamento de tempo restante.
       *
       * Isso resolve o caso de planos com muitos steps e delays curtos (ex: 5-30s):
       * o tick aguarda o próximo step virar e o processa em vez de sair e esperar
       * o cron de 1 minuto.
       */
      const elapsedNow = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsedNow;

      const { data: nextStep } = await supabase
        .from('maturation_steps')
        .select('scheduled_at')
        .eq('status', 'pending')
        .gt('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nextStep) {
        logVerbose(`${LOG_MANUAL} Nenhum step pendente ou futuro para processar`);
        break;
      }

      const waitMs = new Date((nextStep as any).scheduled_at).getTime() - Date.now();

      if (waitMs > 0 && waitMs + STEP_TIME_BUDGET_MS < remainingMs) {
        // Próximo step cabe no orçamento — aguarda e reprocessa
        logVerbose(
          `${LOG_MANUAL} Próximo step em ${Math.ceil(waitMs / 1000)}s (orçamento restante ${Math.ceil(remainingMs / 1000)}s), aguardando...`
        );
        await new Promise((r) => setTimeout(r, waitMs + 150)); // +150ms de margem para o clock
        continue; // Tenta claim novamente
      }

      // Próximo step vence depois do nosso orçamento — encadeia outro tick
      logVerbose(
        `${LOG_MANUAL} Próximo step em ${Math.ceil(waitMs / 1000)}s, fora do orçamento restante (${Math.ceil(remainingMs / 1000)}s). Sinaliza encadeamento.`
      );
      hasMorePending = true;
      break;
    }
    logVerbose(`${LOG_MANUAL} ${steps.length} step(s) reivindicados para envio (Evolution API)`);

    for (const step of steps) {
      const stepElapsed = Date.now() - startTime;
      if (stepElapsed + FETCH_TIMEOUT_MS > MAX_RUNTIME_MS) {
        // Sem tempo para este step — reseta para 'pending' para ser pego no próximo tick
        logVerbose(`${LOG_MANUAL} Sem tempo para step job=${step.job_id} step_index=${step.step_index}, resetando para 'pending'`);
        await supabase
          .from('maturation_steps')
          .update({ status: 'pending', locked_at: null, locked_by: null })
          .eq('id', step.id)
          .eq('status', 'processing');
        hasMorePending = true;
        continue;
      }
      await processStep(supabase, step, { invalidWhatsappDestByScope });
      processedJobIds.add(step.job_id);
      totalProcessed++;
    }

    await Promise.all(Array.from(processedJobIds).map((id) => updateJobProgress(supabase, id)));

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  logVerbose(`${LOG_AUTO} Fase 2: Auto maturador - instâncias virgem em maturação automática`);
  const virginCount = await processVirginMaturation(supabase);

  // Encadeamento por mesh: se algum controller tem ciclo dentro dos próximos 60s, sinaliza pro caller
  if (!hasMorePending) {
    const soonIso = new Date(Date.now() + 60_000).toISOString();
    const { data: nextMesh } = await supabase
      .from('maturation_jobs')
      .select('id')
      .eq('mesh_is_controller', true)
      .eq('status', 'running')
      .lte('mesh_next_cycle_at', soonIso)
      .limit(1)
      .maybeSingle();
    if (nextMesh) hasMorePending = true;
  }

  const elapsed = Date.now() - startTime;
  logVerbose(`${LOG_PREFIX} ========== Fim do tick (${elapsed}ms) hasMorePending=${hasMorePending} ==========`);
  logVerbose(
    `${LOG_PREFIX} Resumo: Maturador manual=${totalProcessed} steps processados, ${processedJobIds.size} job(s); Auto maturador=${virginCount} instância(s) virgem; Mesh=${meshCyclesAdvanced} ciclo(s)`
  );
  return {
    processed: totalProcessed,
    virginCount,
    meshCyclesAdvanced,
    jobs: Array.from(processedJobIds),
    hasMorePending,
  };
  } finally {
    _tickMutex = false;
  }
}
