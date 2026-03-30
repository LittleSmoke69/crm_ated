/**
 * Processor module for maturation steps.
 * Extracts the logic from the maturation-tick Netlify function to be shared with Next.js API routes.
 */

import { SupabaseClient } from '@supabase/supabase-js';

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
const VIRGIN_CONFIG_KEY_MESSAGES = 'messages';

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
    if (Array.isArray(raw)) return raw.join('; ');
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') return JSON.stringify(raw);
  } catch {}
  return fallback;
}

function isConnectionClosedError(params: { error?: string; httpStatus?: number }): boolean {
  const msg = (params.error || '').toLowerCase();
  return msg.includes('connection closed') || msg.includes('conexão fechada') || msg.includes('connection is closed');
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
    console.log(`${LOG_PREFIX} [Evolution API] sendText - URL: ${url}`);
    console.log(`${LOG_PREFIX} [Evolution API] sendText - Body: number=${numberNorm}, text=${text?.substring(0, 50)}${text?.length > 50 ? '...' : ''}`);
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
    const evDetail = MATURATION_VERBOSE_LOGS || VERBOSE_EVOLUTION_LOGS;
    if (evDetail) {
      console.log(`${LOG_PREFIX} [Evolution API] sendText - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
      if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendText - Error body: ${responseText?.substring(0, 200)}`);
    } else if (!response.ok) {
      console.warn(`${LOG_PREFIX} [Evolution API] sendText HTTP ${response.status}: ${responseText?.substring(0, 200)}`);
    }
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status };
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    return { success: false, latencyMs, error: error.name === 'AbortError' ? 'Timeout' : error.message };
  }
}

async function sendMedia(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  mimetype: string;
  caption?: string;
}): Promise<{ success: boolean; latencyMs: number; httpStatus?: number; error?: string; mediaUrl?: string }> {
  const { baseUrl, instanceName, apiKey, number, mediaUrl, mediaType, mimetype, caption } = params;
  const numberNorm = normalizeNumberForEvolution(number);
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendMedia/${instanceName}`;
  const body: any = { number: numberNorm, mediatype: mediaType, mimetype, media: mediaUrl, fileName: mediaType === 'image' ? 'image.png' : 'file' };
  if (caption) body.caption = caption;
  if (VERBOSE_EVOLUTION_LOGS) {
    console.log(`${LOG_PREFIX} [Evolution API] sendMedia - URL: ${url}`);
    console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Body: number=${numberNorm}, mediaType=${mediaType}, mediaUrl=${mediaUrl?.substring(0, 80)}...`);
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
    const evDetail = MATURATION_VERBOSE_LOGS || VERBOSE_EVOLUTION_LOGS;
    if (evDetail) {
      console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
      if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Error body: ${responseText?.substring(0, 200)}`);
    } else if (!response.ok) {
      console.warn(`${LOG_PREFIX} [Evolution API] sendMedia HTTP ${response.status}: ${responseText?.substring(0, 200)}`);
    }
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status, mediaUrl };
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg, mediaUrl };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    return { success: false, latencyMs, error: error.name === 'AbortError' ? 'Timeout' : error.message, mediaUrl };
  }
}

async function sendAudio(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string;
  audioUrl: string;
}): Promise<{ success: boolean; latencyMs: number; httpStatus?: number; error?: string }> {
  const { baseUrl, instanceName, apiKey, number, audioUrl } = params;
  const numberNorm = normalizeNumberForEvolution(number);
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendWhatsAppAudio/${instanceName}`;
  const body = { number: numberNorm, audio: audioUrl };
  if (VERBOSE_EVOLUTION_LOGS) {
    console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - URL: ${url}`);
    console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Body: number=${numberNorm}, audioUrl=${audioUrl?.substring(0, 80)}...`);
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
    const evDetail = MATURATION_VERBOSE_LOGS || VERBOSE_EVOLUTION_LOGS;
    if (evDetail) {
      console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
      if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Error body: ${responseText?.substring(0, 200)}`);
    } else if (!response.ok) {
      console.warn(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio HTTP ${response.status}: ${responseText?.substring(0, 200)}`);
    }
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status };
    const errorMsg = extractErrorMessage(responseText, `HTTP ${response.status}`);
    return { success: false, latencyMs, httpStatus: response.status, error: errorMsg };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    return { success: false, latencyMs, error: error.name === 'AbortError' ? 'Timeout' : error.message };
  }
}

async function getSignedUrl(supabase: SupabaseClient, assetPath: string, bucket: string = DEFAULT_MEDIA_BUCKET): Promise<string | null> {
  let b = bucket;
  let p = assetPath;
  if (assetPath.includes('/')) {
    const parts = assetPath.split('/');
    b = parts[0];
    p = parts.slice(1).join('/');
  }
  try {
    const { data, error } = await supabase.storage.from(b).createSignedUrl(p, 3600);
    return error ? null : data?.signedUrl || null;
  } catch { return null; }
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

async function processStep(supabase: SupabaseClient, step: any): Promise<void> {
  const { id, job_id, step_index, type, instance_name, target_chat_id, base_url, api_key, payload_json, attempts } = step;
  logVerbose(
    `${LOG_MANUAL} Step job=${job_id} step_index=${step_index} type=${type} instance=${instance_name} destino=${target_chat_id ? `${String(target_chat_id).slice(0, 20)}...` : 'vazio'}`
  );
  if (!target_chat_id) {
    const msg = 'Destino não definido para este step.';
    await supabase.from('maturation_steps').update({ status: 'failed', error: msg }).eq('id', id);
    await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', type: 'error', title: 'Step ignorado', content: msg, status: 'failed' });
    return;
  }
  await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'system', instanceLabel: instance_name, type: 'info', title: `⏳ Enviando ${type}...`, content: `Enviando ${type} pela instância ${instance_name}`, status: 'info' });
  
  let result: any;
  if (type === 'text') {
    result = await sendText({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, text: payload_json?.text || '' });
  } else if (['video', 'image', 'audio'].includes(type)) {
    // media_path → Supabase Storage (gera signed URL)
    // media_url  → URL direta (usada quando o plano é criado via UI com URL externa)
    // assetPath/assetId → legado
    const storagePath = payload_json.media_path || payload_json.assetPath || payload_json.assetId;
    const directUrl = payload_json.media_url as string | undefined;
    let url: string | null = null;

    if (storagePath) {
      url = await getSignedUrl(supabase, storagePath, DEFAULT_MEDIA_BUCKET);
    } else if (directUrl && directUrl.startsWith('http')) {
      url = directUrl;
    }

    if (!url) result = { success: false, error: 'Erro ao obter URL da mídia (configure media_path ou media_url no step)' };
    else if (type === 'video') result = await sendMedia({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, mediaUrl: url, mediaType: 'video', mimetype: 'video/mp4', caption: payload_json.caption });
    else if (type === 'image') result = await sendMedia({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, mediaUrl: url, mediaType: 'image', mimetype: 'image/png', caption: payload_json.caption });
    else result = await sendAudio({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, audioUrl: url });
  } else result = { success: false, error: 'Tipo desconhecido' };

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
      return;
    }

    const newAttempts = (attempts || 0) + 1;
    console.warn(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} FALHA tentativa=${newAttempts}/${MAX_ATTEMPTS} erro=${result.error}`);
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
  const { count: sent } = await supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'sent');
  const { count: failed } = await supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'failed');
  const { count: total } = await supabase.from('maturation_steps').select('id', { count: 'exact', head: true }).eq('job_id', jobId);
  const sentN = sent || 0;
  const failedN = failed || 0;
  const totalN = total || 0;
  /** progress_done = apenas steps enviados com sucesso (UI e barra; falhas não aparecem como “concluído”) */
  const terminalDone = sentN + failedN;
  await supabase.from('maturation_jobs').update({ progress_done: sentN }).eq('id', jobId);
  if (totalN && terminalDone >= totalN) {
    logVerbose(`${LOG_MANUAL} Job ${jobId} finalizado: ${terminalDone}/${totalN} steps (sent=${sentN}, failed=${failedN})`);
    await supabase.from('maturation_jobs').update({ status: 'finished', ended_at: new Date().toISOString() }).eq('id', jobId);
    const { data: j } = await supabase.from('maturation_jobs').select('master_instance_id').eq('id', jobId).single();
    if (j) await supabase.from('master_instances').update({ is_locked: false, locked_job_id: null, locked_at: null }).eq('id', j.master_instance_id);
    await createMessage(supabase, { jobId, direction: 'system', type: 'info', title: '✅ Job finalizado', content: 'Todos os steps processados', status: 'info' });
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

  const masterInstanceId = masterRow.id as string;

  // Verifica se já há job running para este master
  const { data: activeJob } = await supabase
    .from('maturation_jobs')
    .select('id')
    .eq('master_instance_id', masterInstanceId)
    .eq('status', 'running')
    .maybeSingle();

  if (activeJob) {
    // Já há job ativo, não precisa criar outro
    return;
  }

  // Busca mensagens configuradas para o auto-maturador
  const { data: configRow } = await supabase
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', VIRGIN_CONFIG_KEY_MESSAGES)
    .maybeSingle();

  const rawMessages = configRow?.value_json;
  const messages: VirginMessage[] = Array.isArray(rawMessages) && rawMessages.length > 0
    ? rawMessages.filter((m: any) => m && (typeof m === 'string' || (typeof m === 'object' && m.type)))
    : VIRGIN_MESSAGES_FALLBACK;

  if (messages.length === 0) {
    console.warn(`${LOG_AUTO} ${inst.instance_name}: nenhuma mensagem configurada para warmup`);
    return;
  }

  // Encontra um destino: phone_number de outra instância mestre disponível
  const { data: targetInstance } = await supabase
    .from('master_instances')
    .select(`evolution_instances!inner ( phone_number )`)
    .eq('is_active', true)
    .eq('is_locked', false)
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

  // Busca o plano auto-maturador (UUID fixo)
  const PLAN_ID_VIRGIN = 'a0000000-0000-0000-0000-000000000001';
  const { data: plan } = await supabase
    .from('maturation_plans')
    .select('id')
    .eq('id', PLAN_ID_VIRGIN)
    .eq('is_active', true)
    .maybeSingle();

  const planId = plan?.id ?? PLAN_ID_VIRGIN;

  // Cria os steps a partir das mensagens configuradas
  const delaySec = 10;
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

  // Bloqueia a instância mestre para este job
  await supabase.from('master_instances')
    .update({ is_locked: true, locked_job_id: job.id, locked_at: now.toISOString() })
    .eq('id', masterInstanceId);

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
  results: Array<{ step_index: number; status: 'sent' | 'failed' | 'pending' }>;
};

/**
 * Processa em lote todos os steps atrasados (scheduled_at <= now) de um job.
 * Envia direto para a Evolution API. Retorna quantos foram enviados, falharam e o status por step.
 */
export async function runJobCatchUp(supabase: SupabaseClient, jobId: string): Promise<CatchUpResult> {
  const results: Array<{ step_index: number; status: 'sent' | 'failed' | 'pending' }> = [];
  let sent = 0;
  let failed = 0;

  const { data: job, error: jobErr } = await supabase
    .from('maturation_jobs')
    .select(`
      id,
      target_chat_id,
      master_instance_id,
      status
    `)
    .eq('id', jobId)
    .single();

  if (jobErr || !job || job.status !== 'running') {
    logVerbose(`${LOG_MANUAL} runJobCatchUp job=${jobId} ignorado (não encontrado ou não running)`);
    return { sent: 0, failed: 0, results: [] };
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
    return { sent: 0, failed: 0, results: [] };
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
    return { sent: 0, failed: 0, results: [] };
  }

  for (const row of steps) {
    const target_chat_id = (row.target_chat_id && String(row.target_chat_id).trim()) || job.target_chat_id || null;
    const stepEnriched = {
      id: row.id,
      job_id: row.job_id,
      step_index: row.step_index,
      type: row.type,
      payload_json: row.payload_json || {},
      attempts: row.attempts || 0,
      instance_name,
      base_url,
      api_key,
      target_chat_id,
    };
    await processStep(supabase, stepEnriched);
    const { data: updated } = await supabase
      .from('maturation_steps')
      .select('status')
      .eq('id', row.id)
      .single();
    const st = updated?.status === 'sent' ? 'sent' : updated?.status === 'failed' ? 'failed' : 'pending';
    results.push({ step_index: row.step_index, status: st });
    if (st === 'sent') sent++;
    else if (st === 'failed') failed++;
  }

  await updateJobProgress(supabase, jobId);
  logVerbose(`${LOG_MANUAL} runJobCatchUp job=${jobId} concluído: sent=${sent} failed=${failed}`);
  return { sent, failed, results };
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

export async function runMaturationTick(supabase: SupabaseClient): Promise<any> {
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

  // Fase 0: Recuperar steps travados em 'processing' de ticks anteriores
  await recoverStuckSteps(supabase);

  logVerbose(`${LOG_MANUAL} Fase 1: Maturador (manual) - jobs com steps agendados`);

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
      await processStep(supabase, step);
      processedJobIds.add(step.job_id);
      totalProcessed++;
    }

    for (const id of processedJobIds) {
      await updateJobProgress(supabase, id);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  logVerbose(`${LOG_AUTO} Fase 2: Auto maturador - instâncias virgem em maturação automática`);
  const virginCount = await processVirginMaturation(supabase);

  const elapsed = Date.now() - startTime;
  logVerbose(`${LOG_PREFIX} ========== Fim do tick (${elapsed}ms) hasMorePending=${hasMorePending} ==========`);
  logVerbose(
    `${LOG_PREFIX} Resumo: Maturador manual=${totalProcessed} steps processados, ${processedJobIds.size} job(s); Auto maturador=${virginCount} instância(s) virgem em maturação`
  );
  return { processed: totalProcessed, virginCount, jobs: Array.from(processedJobIds), hasMorePending };
}
