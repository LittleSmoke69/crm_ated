/**
 * Processor module for maturation steps.
 * Extracts the logic from the maturation-tick Netlify function to be shared with Next.js API routes.
 */

import { SupabaseClient } from '@supabase/supabase-js';

const CLAIM_LIMIT = 10;
const MAX_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 30000;
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
  console.log(`${LOG_PREFIX} [Evolution API] sendText - URL: ${url}`);
  console.log(`${LOG_PREFIX} [Evolution API] sendText - Body: number=${numberNorm}, text=${text?.substring(0, 50)}${text?.length > 50 ? '...' : ''}`);
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
    console.log(`${LOG_PREFIX} [Evolution API] sendText - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
    if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendText - Error body: ${responseText?.substring(0, 200)}`);
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status };
    let errorMsg = `HTTP ${response.status}`;
    try {
      const data = JSON.parse(responseText);
      errorMsg = data?.message || data?.error || errorMsg;
    } catch {}
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
  console.log(`${LOG_PREFIX} [Evolution API] sendMedia - URL: ${url}`);
  console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Body: number=${numberNorm}, mediaType=${mediaType}, mediaUrl=${mediaUrl?.substring(0, 80)}...`);
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
    console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
    if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendMedia - Error body: ${responseText?.substring(0, 200)}`);
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status, mediaUrl };
    let errorMsg = `HTTP ${response.status}`;
    try {
      const data = JSON.parse(responseText);
      errorMsg = data?.message || data?.error || errorMsg;
    } catch {}
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
  console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - URL: ${url}`);
  console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Body: number=${numberNorm}, audioUrl=${audioUrl?.substring(0, 80)}...`);
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
    console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Response: HTTP ${response.status}, latency=${latencyMs}ms`);
    if (!response.ok) console.log(`${LOG_PREFIX} [Evolution API] sendWhatsAppAudio - Error body: ${responseText?.substring(0, 200)}`);
    if (response.ok) return { success: true, latencyMs, httpStatus: response.status };
    let errorMsg = `HTTP ${response.status}`;
    try {
      const data = JSON.parse(responseText);
      errorMsg = data?.message || data?.error || errorMsg;
    } catch {}
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
  console.log(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} type=${type} instance=${instance_name} destino=${target_chat_id ? `${String(target_chat_id).slice(0, 20)}...` : 'vazio'}`);
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
    const path = payload_json.media_path || payload_json.assetPath || payload_json.assetId;
    const url = await getSignedUrl(supabase, path, DEFAULT_MEDIA_BUCKET);
    if (!url) result = { success: false, error: 'Erro ao gerar URL assinada' };
    else if (type === 'video') result = await sendMedia({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, mediaUrl: url, mediaType: 'video', mimetype: 'video/mp4', caption: payload_json.caption });
    else if (type === 'image') result = await sendMedia({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, mediaUrl: url, mediaType: 'image', mimetype: 'image/png', caption: payload_json.caption });
    else result = await sendAudio({ baseUrl: base_url, instanceName: instance_name, apiKey: api_key, number: target_chat_id, audioUrl: url });
  } else result = { success: false, error: 'Tipo desconhecido' };

  const typeLabel = type === 'text' ? 'Mensagem' : type === 'video' ? 'Vídeo' : type === 'image' ? 'Imagem' : 'Áudio';
  if (result.success) {
    console.log(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} OK enviado (${result.latencyMs}ms)`);
    await supabase.from('maturation_steps').update({ status: 'sent', sent_at: new Date().toISOString(), latency_ms: result.latencyMs, http_status: result.httpStatus }).eq('id', id);
    await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'instance', instanceLabel: instance_name, type, title: `✅ ${typeLabel} enviado`, content: `${typeLabel} enviado pela instância ${instance_name}`, mediaUrl: result.mediaUrl, status: 'sent', latencyMs: result.latencyMs, httpStatus: result.httpStatus });
  } else {
    const newAttempts = (attempts || 0) + 1;
    console.log(`${LOG_MANUAL} Step job=${job_id} step_index=${step_index} FALHA tentativa=${newAttempts}/${MAX_ATTEMPTS} erro=${result.error}`);
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
  const done = (sent || 0) + (failed || 0);
  await supabase.from('maturation_jobs').update({ progress_done: done }).eq('id', jobId);
  if (total && done >= total) {
    console.log(`${LOG_MANUAL} Job ${jobId} finalizado: ${done}/${total} steps (sent=${sent}, failed=${failed})`);
    await supabase.from('maturation_jobs').update({ status: 'finished', ended_at: new Date().toISOString() }).eq('id', jobId);
    const { data: j } = await supabase.from('maturation_jobs').select('master_instance_id').eq('id', jobId).single();
    if (j) await supabase.from('master_instances').update({ is_locked: false, locked_job_id: null, locked_at: null }).eq('id', j.master_instance_id);
    await createMessage(supabase, { jobId, direction: 'system', type: 'info', title: '✅ Job finalizado', content: 'Todos os steps processados', status: 'info' });
  }
}

/**
 * Auto maturador: instâncias com maturation_type='virgem' entram em maturação automática (5 dias).
 * Igual ao maturador manual (plano de mensagens com delays), mas disparado automaticamente para virgens.
 * Este tick apenas verifica e registra em log as instâncias virgem em maturação; o envio de mensagens
 * virgem pode ser feito por outro worker ou extensão futura.
 */
async function processVirginMaturation(supabase: SupabaseClient): Promise<number> {
  const { data: virgins, error } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, maturation_status, maturation_started_at, maturation_ends_at, current_day, is_locked')
    .eq('maturation_type', 'virgem')
    .not('maturation_status', 'is', null)
    .eq('is_active', true);

  if (error) {
    console.log(`${LOG_AUTO} Erro ao listar instâncias virgem: ${error.message}`);
    return 0;
  }
  const list = virgins || [];
  if (list.length === 0) {
    console.log(`${LOG_AUTO} Nenhuma instância virgem em auto maturação no momento`);
    return 0;
  }
  console.log(`${LOG_AUTO} ${list.length} instância(s) virgem em auto maturação:`);
  for (const v of list) {
    const status = (v as any).maturation_status || '?';
    const day = (v as any).current_day ?? '?';
    const endsAt = (v as any).maturation_ends_at ? new Date((v as any).maturation_ends_at).toLocaleString('pt-BR') : '?';
    console.log(`${LOG_AUTO}   - ${(v as any).instance_name} status=${status} dia=${day} termina=${endsAt} locked=${!!(v as any).is_locked}`);
  }
  return list.length;
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
    console.log(`${LOG_MANUAL} runJobCatchUp job=${jobId} ignorado (não encontrado ou não running)`);
    return { sent: 0, failed: 0, results: [] };
  }
  console.log(`${LOG_MANUAL} runJobCatchUp job=${jobId} processando steps atrasados`);

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
    console.log(`${LOG_PREFIX} runJobCatchUp - Credenciais não encontradas para job ${jobId}`);
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
  console.log(`${LOG_MANUAL} runJobCatchUp job=${jobId} concluído: sent=${sent} failed=${failed}`);
  return { sent, failed, results };
}

export async function runMaturationTick(supabase: SupabaseClient): Promise<any> {
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 20000; // 20 segundos para evitar timeout de API
  let totalProcessed = 0;
  const processedJobIds = new Set<string>();

  console.log(`${LOG_PREFIX} ========== Tick Maturador ==========`);
  console.log(`${LOG_MANUAL} Fase 1: Maturador (manual) - jobs com steps agendados`);

  while (Date.now() - startTime < MAX_RUNTIME_MS) {
    const { data: steps, error } = await supabase.rpc('claim_maturation_steps', { claim_limit: CLAIM_LIMIT });
    if (error) {
      console.log(`${LOG_MANUAL} Erro ao reivindicar steps: ${error.message}`);
      break;
    }
    if (!steps || steps.length === 0) {
      console.log(`${LOG_MANUAL} Nenhum step pendente para processar`);
      break;
    }
    console.log(`${LOG_MANUAL} ${steps.length} step(s) reivindicados para envio (Evolution API)`);

    for (const step of steps) {
      await processStep(supabase, step);
      processedJobIds.add(step.job_id);
      totalProcessed++;
    }

    for (const id of processedJobIds) {
      await updateJobProgress(supabase, id);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`${LOG_AUTO} Fase 2: Auto maturador - instâncias virgem em maturação automática`);
  const virginCount = await processVirginMaturation(supabase);

  const elapsed = Date.now() - startTime;
  console.log(`${LOG_PREFIX} ========== Fim do tick (${elapsed}ms) ==========`);
  console.log(`${LOG_PREFIX} Resumo: Maturador manual=${totalProcessed} steps processados, ${processedJobIds.size} job(s); Auto maturador=${virginCount} instância(s) virgem em maturação`);
  return { processed: totalProcessed, virginCount, jobs: Array.from(processedJobIds) };
}
