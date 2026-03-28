/**
 * Worker de campanhas de disparo em massa (ativações).
 * Usado pela rota POST /api/crm/activations/mass-send/process.
 * Chama a Evolution API diretamente (sem passar por /api/send).
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import type { ApiResponse } from '@/lib/utils/response';

// ─── Constantes ───────────────────────────────────────────────────────────────

const INTER_GROUP_DELAY_MS = 1_000;
const LOCK_TTL_MS = 4 * 60 * 1000;
const INNER_LOOP_BUDGET_MS = 110_000;
const EVOLUTION_FETCH_TIMEOUT_MS = 30_000;
const PTV_FETCH_TIMEOUT_MS = 45_000;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type DbMessage = {
  id: string;
  content: string | null;
  title: string | null;
  message_type: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_mime: string | null;
  mention_all: boolean | null;
  ptv_delay: number | null;
};

type EvolutionContext = {
  jobId: string;
  userId: string;
  message: DbMessage;
  instanceName: string;
  instanceId: string;
  apiKey: string;
  baseUrl: string;
  ptvVideoPayload: string | null;
  isMentionAll: boolean;
  messageContent: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function fetchVideoUrlAsBase64(videoUrl: string): Promise<string> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), PTV_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(videoUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar vídeo`);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } finally {
    clearTimeout(tid);
  }
}

async function regenerateSignedUrl(message: DbMessage): Promise<string | null> {
  const url = message.attachment_url;
  if (!url || !url.includes('supabase.co/storage/v1')) return url;
  try {
    const match = url.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+?)(\?|$)/);
    if (!match?.[1] || !match?.[2]) return url;
    const bucket = match[1];
    const path = decodeURIComponent(match[2]);
    const { data, error } = await supabaseServiceRole.storage.from(bucket).createSignedUrl(path, 31536000);
    if (error || !data?.signedUrl) return url;
    await supabaseServiceRole.from('messages').update({ attachment_url: data.signedUrl }).eq('id', message.id);
    return data.signedUrl;
  } catch {
    return url;
  }
}

function isTransientError(error?: string): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes('timeout') || e.includes('fetch failed') || e.includes('504') || e.includes('502') || e.includes('503') || e.includes('econnreset') || e.includes('econnrefused');
}

// ─── Build Evolution Context (uma vez por job) ───────────────────────────────

async function buildEvolutionContext(
  job: { id: string; user_id: string; message_id: string; instance_name: string }
): Promise<{ ctx: EvolutionContext } | { error: string }> {
  const { data: message, error: msgErr } = await supabaseServiceRole
    .from('messages')
    .select('id, content, title, message_type, attachment_url, attachment_type, attachment_mime, mention_all, ptv_delay')
    .eq('id', job.message_id)
    .single();

  if (msgErr || !message) {
    return { error: `Mensagem ${job.message_id} não encontrada` };
  }

  const { data: instance, error: instErr } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, apikey, instance_name, evolution_apis!inner(base_url)')
    .eq('instance_name', job.instance_name)
    .eq('user_id', job.user_id)
    .eq('is_active', true)
    .single();

  if (instErr || !instance) {
    return { error: `Instância ${job.instance_name} não encontrada ou inativa` };
  }

  const api = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
  const baseUrl = (api as { base_url?: string })?.base_url;
  const apiKey = instance.apikey as string;

  if (!baseUrl || !apiKey) {
    return { error: 'Instância sem base_url ou apikey' };
  }

  const freshUrl = await regenerateSignedUrl(message as DbMessage);
  if (freshUrl) (message as DbMessage).attachment_url = freshUrl;

  let ptvVideoPayload: string | null = null;
  if (message.message_type === 'ptv' && message.attachment_url) {
    const v = String(message.attachment_url).trim();
    if (v.startsWith('http://') || v.startsWith('https://')) {
      try {
        ptvVideoPayload = await fetchVideoUrlAsBase64(v);
        console.log(`[MassSend] PTV base64 baixado: ${Math.round(ptvVideoPayload.length / 1024)}KB`);
      } catch (e: any) {
        return { error: `Falha ao baixar vídeo PTV: ${e.message}` };
      }
    } else {
      ptvVideoPayload = v;
    }
  }

  const isMentionAll = message.mention_all === true || String(message.mention_all).toLowerCase() === 'true';
  const messageContent = message.content ? String(message.content).trim() : '';

  return {
    ctx: {
      jobId: job.id,
      userId: job.user_id,
      message: message as DbMessage,
      instanceName: job.instance_name,
      instanceId: instance.id as string,
      apiKey,
      baseUrl: normalizeUrl(baseUrl),
      ptvVideoPayload,
      isMentionAll,
      messageContent,
    },
  };
}

// ─── Envio direto para Evolution API ──────────────────────────────────────────

async function sendGroupToEvolution(
  ctx: EvolutionContext,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const { baseUrl, instanceName, apiKey, message, ptvVideoPayload, isMentionAll, messageContent } = ctx;

  let url: string;
  let body: Record<string, unknown>;

  if (message.message_type === 'ptv' && ptvVideoPayload) {
    url = `${baseUrl}/message/sendPtv/${instanceName}`;
    const delay = typeof message.ptv_delay === 'number' && message.ptv_delay >= 0 ? message.ptv_delay : 1200;
    body = { number: groupId, video: ptvVideoPayload, delay };
  } else if (message.message_type === 'audio' && message.attachment_url) {
    url = `${baseUrl}/message/sendWhatsAppAudio/${instanceName}`;
    body = {
      number: groupId,
      audio: String(message.attachment_url),
      ...(isMentionAll && { mentionsEveryOne: true }),
    };
  } else if (message.message_type === 'text_with_attachment' && message.attachment_url) {
    url = `${baseUrl}/message/sendMedia/${instanceName}`;
    const { mediatype, mimetype, fileName } = resolveMediaMeta(message);
    body = {
      number: groupId,
      mediatype,
      mimetype,
      media: String(message.attachment_url),
      fileName,
      ...(messageContent ? { caption: messageContent } : {}),
      ...(isMentionAll && { mentionsEveryOne: true }),
    };
  } else {
    if (!messageContent) return { success: false, error: 'Mensagem sem conteúdo' };
    url = `${baseUrl}/message/sendText/${instanceName}`;
    body = {
      number: groupId,
      text: messageContent,
      ...(isMentionAll && { mentionsEveryOne: true }),
    };
  }

  url = normalizeUrl(url);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), EVOLUTION_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let errMsg = '';
      try {
        const j = JSON.parse(text);
        const src = j.message ?? j.response?.message ?? j.error;
        errMsg = Array.isArray(src) ? src.join('; ') : String(src || '');
      } catch {
        errMsg = text.slice(0, 300);
      }

      if (/connection\s*closed/i.test(errMsg)) {
        await supabaseServiceRole
          .from('evolution_instances')
          .update({ status: 'disconnected', updated_at: new Date().toISOString() })
          .eq('id', ctx.instanceId);
      }

      const userMsg = sanitizeMassSendErrorMessage(errMsg) || `Erro ${res.status}: ${res.statusText}`;
      return { success: false, error: userMsg };
    }

    return { success: true };
  } catch (e: any) {
    clearTimeout(tid);
    if (e.name === 'AbortError') {
      return { success: false, error: `Timeout: Evolution não respondeu em ${EVOLUTION_FETCH_TIMEOUT_MS / 1000}s` };
    }
    return { success: false, error: e.message || 'Erro de rede ao chamar Evolution' };
  }
}

function resolveMediaMeta(message: DbMessage): { mediatype: string; mimetype: string; fileName: string } {
  const mime = message.attachment_mime || 'image/png';
  if (message.attachment_type === 'video') return { mediatype: 'video', mimetype: message.attachment_mime || 'video/mp4', fileName: 'video.mp4' };
  if (message.attachment_type === 'audio') return { mediatype: 'document', mimetype: message.attachment_mime || 'audio/mpeg', fileName: 'audio.mp3' };
  if (message.attachment_type === 'image') {
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : 'png';
    return { mediatype: 'image', mimetype: mime, fileName: `image.${ext}` };
  }
  const url = String(message.attachment_url || '').toLowerCase();
  if (url.match(/\.(mp4|mov|avi|webm)/) || mime.startsWith('video/')) return { mediatype: 'video', mimetype: mime || 'video/mp4', fileName: 'video.mp4' };
  if (url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)/) || mime.startsWith('application/')) return { mediatype: 'document', mimetype: mime || 'application/pdf', fileName: 'file' };
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : 'png';
  return { mediatype: 'image', mimetype: mime, fileName: `image.${ext}` };
}

// ─── Persistir resultado de um grupo ──────────────────────────────────────────

async function persistGroupResult(
  jobId: string,
  groupId: string,
  result: { success: boolean; error?: string },
  newProcessedIndex: number,
  isComplete: boolean
): Promise<void> {
  const now = new Date().toISOString();
  const outcome = [{ groupId, success: result.success, ...(result.error ? { error: result.error } : {}) }];

  const { error: rpcErr } = await supabaseServiceRole.rpc('increment_mass_send_job_counts', {
    p_job_id: jobId,
    p_sent: result.success ? 1 : 0,
    p_failed: result.success ? 0 : 1,
    p_processed_index: newProcessedIndex,
    p_last_error: result.error || null,
    p_status: isComplete ? 'completed' : 'processing',
    p_now: now,
    p_group_outcomes: outcome,
  });

  if (rpcErr) {
    console.error(`[MassSend] RPC falhou — fallback direto:`, rpcErr.message);
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({
        processed_index: newProcessedIndex,
        status: isComplete ? 'completed' : 'processing',
        updated_at: now,
      })
      .eq('id', jobId);
  }
}

// ─── Release lock helper ─────────────────────────────────────────────────────

async function releaseLock(jobId: string): Promise<void> {
  await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

// ─── Orquestrador principal ───────────────────────────────────────────────────

export async function executeMassSendProcess(_publicOrigin?: string | null): Promise<ApiResponse> {
  const budgetEnd = Date.now() + INNER_LOOP_BUDGET_MS;
  const lockExpired = new Date(Date.now() - LOCK_TTL_MS).toISOString();

  // Busca próximo job
  const { data: jobs } = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .select('id, user_id, message_id, instance_name, group_ids, total_groups, processed_index, status')
    .in('status', ['pending', 'processing'])
    .or(`locked_at.is.null,locked_at.lt.${lockExpired}`)
    .order('created_at', { ascending: true })
    .limit(1);

  const job = jobs?.[0];
  if (!job) {
    return { success: true, data: { processed: false, message: 'Nenhum job pendente' } };
  }

  const groupIds = Array.isArray(job.group_ids) ? (job.group_ids as string[]) : [];
  const start = Number(job.processed_index) || 0;

  if (start >= groupIds.length) {
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ status: 'completed', locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return { success: true, data: { processed: true, job_id: job.id, status: 'completed' } };
  }

  // ── Adquire lock UMA VEZ para todo o lote ──────────────────────────────────
  const now = new Date().toISOString();
  const locked = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({ status: 'processing', locked_at: now, locked_by: 'mass-send-worker', updated_at: now })
    .eq('id', job.id)
    .in('status', [job.status, 'processing'])
    .or('locked_at.is.null,locked_at.lt.' + lockExpired)
    .select('id')
    .single();

  if (locked.error || !locked.data) {
    console.log(`[MassSend] Job ${shortId(job.id)} — não conseguiu adquirir lock (outro worker?)`);
    return { success: true, data: { processed: false, message: 'Job locked por outro worker' } };
  }

  // Build context (mensagem + instância) — UMA VEZ por job
  console.log(`[MassSend] ══════════════════════════════════════════════════`);
  console.log(`[MassSend] Job ${shortId(job.id)} | inst: ${job.instance_name} | ${groupIds.length} grupos (index: ${start})`);
  console.log(`[MassSend] ══════════════════════════════════════════════════`);

  const ctxResult = await buildEvolutionContext(job);
  if ('error' in ctxResult) {
    console.error(`[MassSend] Erro ao montar contexto: ${ctxResult.error}`);
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({
        status: 'failed',
        last_error: ctxResult.error,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { success: false, error: ctxResult.error };
  }

  const { ctx } = ctxResult;
  console.log(`[MassSend] Mensagem: "${ctx.message.title || ctx.message.id}" | tipo: ${ctx.message.message_type} | mentionAll: ${ctx.isMentionAll}`);
  const jobStart = Date.now();
  let totalSent = 0;
  let totalFailed = 0;
  let currentIndex = start;
  let paused = false;

  // ── Loop: processa grupo por grupo, lock já adquirido ───────────────────────
  while (currentIndex < groupIds.length && Date.now() < budgetEnd) {
    const groupId = groupIds[currentIndex];
    const total = groupIds.length;

    // Delay fixo de 1s entre grupos (a partir do 2º)
    if (currentIndex > start) {
      await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
    }

    // Checa pausa antes de enviar
    const { data: freshJob } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('status')
      .eq('id', job.id)
      .single();

    if (freshJob?.status === 'paused') {
      console.log(`[MassSend] [${currentIndex + 1}/${total}] PAUSADO pelo usuario`);
      paused = true;
      break;
    }

    // Renova o lock a cada grupo (mantém o mesmo worker, só atualiza locked_at)
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ locked_at: new Date().toISOString() })
      .eq('id', job.id);

    // Envio direto para Evolution
    const t0 = Date.now();
    let result = await sendGroupToEvolution(ctx, groupId);

    // Retry uma vez para erros transientes
    if (!result.success && isTransientError(result.error)) {
      console.warn(`[MassSend] [${currentIndex + 1}/${total}] ${groupId} retry em 3s (${result.error})`);
      await new Promise((r) => setTimeout(r, 3_000));
      result = await sendGroupToEvolution(ctx, groupId);
    }

    const duration = Date.now() - t0;
    const newIdx = currentIndex + 1;
    const isComplete = newIdx >= total;

    if (result.success) {
      console.log(`[MassSend] [${currentIndex + 1}/${total}] ${groupId} OK (${duration}ms)`);
      totalSent++;
    } else {
      console.error(`[MassSend] [${currentIndex + 1}/${total}] ${groupId} FALHA: ${result.error} (${duration}ms)`);
      totalFailed++;
    }

    // Persiste resultado (não toca em locked_at/locked_by)
    await persistGroupResult(job.id, groupId, result, newIdx, isComplete);

    currentIndex = newIdx;
  }

  // ── Libera lock ─────────────────────────────────────────────────────────────
  if (paused) {
    // Pausa: libera lock, mantém status 'paused' (já setado pelo PATCH do usuário)
    await releaseLock(job.id);
  } else {
    await releaseLock(job.id);
  }

  const elapsed = ((Date.now() - jobStart) / 1000).toFixed(1);
  const isComplete = currentIndex >= groupIds.length;
  console.log(`[MassSend] ──────────────────────────────────────────────────`);
  console.log(`[MassSend] Job ${shortId(job.id)} ${isComplete ? 'CONCLUIDO' : paused ? 'PAUSADO' : 'PARCIAL'}: ${totalSent} OK / ${totalFailed} FALHA | ${elapsed}s | processados ate ${currentIndex}/${groupIds.length}`);
  console.log(`[MassSend] ──────────────────────────────────────────────────`);

  const morePending = !isComplete && !paused;

  return {
    success: true,
    data: {
      processed: true,
      job_id: job.id,
      sent: totalSent,
      failed: totalFailed,
      status: isComplete ? 'completed' : paused ? 'paused' : 'processing',
      ...(morePending ? { more_pending: true } : {}),
    },
  };
}
