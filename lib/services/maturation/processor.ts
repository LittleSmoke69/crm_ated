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
  const body = { number: numberNorm, textContent: { text } };
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
  console.log(`${LOG_PREFIX} processStep - job=${job_id} step=${step_index} type=${type} instance=${instance_name} target_chat_id=${target_chat_id} base_url=${base_url}`);
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
    await supabase.from('maturation_steps').update({ status: 'sent', sent_at: new Date().toISOString(), latency_ms: result.latencyMs, http_status: result.httpStatus }).eq('id', id);
    await createMessage(supabase, { jobId: job_id, stepId: id, direction: 'instance', instanceLabel: instance_name, type, title: `✅ ${typeLabel} enviado`, content: `${typeLabel} enviado pela instância ${instance_name}`, mediaUrl: result.mediaUrl, status: 'sent', latencyMs: result.latencyMs, httpStatus: result.httpStatus });
  } else {
    const newAttempts = (attempts || 0) + 1;
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
    await supabase.from('maturation_jobs').update({ status: 'finished', ended_at: new Date().toISOString() }).eq('id', jobId);
    const { data: j } = await supabase.from('maturation_jobs').select('master_instance_id').eq('id', jobId).single();
    if (j) await supabase.from('master_instances').update({ is_locked: false, locked_job_id: null, locked_at: null }).eq('id', j.master_instance_id);
    await createMessage(supabase, { jobId, direction: 'system', type: 'info', title: '✅ Job finalizado', content: 'Todos os steps processados', status: 'info' });
  }
}

async function processVirginMaturation(supabase: SupabaseClient): Promise<number> {
  // Simplificado para este módulo
  return 0;
}

export async function runMaturationTick(supabase: SupabaseClient): Promise<any> {
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 20000; // 20 segundos para evitar timeout de API
  let totalProcessed = 0;
  const processedJobIds = new Set<string>();

  console.log(`${LOG_PREFIX} runMaturationTick - Iniciando processamento`);
  while (Date.now() - startTime < MAX_RUNTIME_MS) {
    const { data: steps, error } = await supabase.rpc('claim_maturation_steps', { claim_limit: CLAIM_LIMIT });
    if (error) {
      console.log(`${LOG_PREFIX} runMaturationTick - Erro ao claim steps:`, error);
      break;
    }
    if (!steps || steps.length === 0) {
      console.log(`${LOG_PREFIX} runMaturationTick - Nenhum step para processar`);
      break;
    }
    console.log(`${LOG_PREFIX} runMaturationTick - ${steps.length} step(s) para processar`);

    for (const step of steps) {
      await processStep(supabase, step);
      processedJobIds.add(step.job_id);
      totalProcessed++;
    }

    for (const id of processedJobIds) {
      await updateJobProgress(supabase, id);
    }
    
    // Pequena pausa para não sobrecarregar o banco
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const virginCount = await processVirginMaturation(supabase);
  console.log(`${LOG_PREFIX} runMaturationTick - Finalizado: processed=${totalProcessed}, jobs=${Array.from(processedJobIds).length}`);
  return { processed: totalProcessed, virginCount, jobs: Array.from(processedJobIds) };
}
