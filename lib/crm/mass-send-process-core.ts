/**
 * Worker de campanhas de disparo em massa (ativações).
 * Cada chamada processa vários grupos até o budget (CALL_BUDGET_MS), persiste via RPC
 * e renova lock enquanto status = processing. Ao esgotar o budget, libera o lock e
 * Encadeamento: a route /mass-send/process usa after() + triggerMassSendProcessFromOrigin.
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveEvolutionInstanceForActivation } from '@/lib/crm/resolve-evolution-instance-for-activation';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import type { ApiResponse } from '@/lib/utils/response';
import {
  hasMassSendGroupAlreadySucceeded,
  isMassSendTransientRetryable,
} from '@/lib/crm/mass-send-group-idempotency';

// ─── Constantes ───────────────────────────────────────────────────────────────

const EVOLUTION_FETCH_TIMEOUT_MS = 30_000;
const PTV_FETCH_TIMEOUT_MS = 45_000;
/**
 * TTL do lock na query de “job disponível”. Precisa cobrir 1 grupo lento + retries
 * (ex.: 30s timeout × tentativas + 3s + 5s) sem outro worker assumir o mesmo job.
 */
const LOCK_TTL_MS = 180_000;
/** Renova locked_at no DB se o último touch foi há mais que isso (antes do fetch Evolution). */
const LOCK_HEARTBEAT_MS = 25_000;

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

function extractErrorCause(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const err = e as { cause?: unknown; message?: string };
  if (err.cause && typeof err.cause === 'object') {
    const cause = err.cause as { code?: string; message?: string; cause?: unknown };
    const parts = [cause.code, cause.message].filter(Boolean);
    if (cause.cause && typeof cause.cause === 'object') {
      const inner = cause.cause as { code?: string; message?: string };
      parts.push(inner.code, inner.message);
    }
    return parts.filter(Boolean).join(' | ');
  }
  return '';
}

/** Campos comuns de erro de rede (Node / undici) para interpretar “fetch failed”. */
type FetchDiag = {
  codes: string[];
  errno?: string | number;
  syscall?: string;
  hostname?: string;
  port?: string | number;
  address?: string;
};

function collectFetchDiagnostics(e: unknown): FetchDiag {
  const codes: string[] = [];
  let errno: string | number | undefined;
  let syscall: string | undefined;
  let hostname: string | undefined;
  let port: string | number | undefined;
  let address: string | undefined;

  function walk(err: unknown, depth: number): void {
    if (!err || typeof err !== 'object' || depth > 8) return;
    const o = err as Record<string, unknown>;
    if (typeof o.code === 'string' && o.code) codes.push(o.code);
    if (o.errno != null && o.errno !== '') errno = o.errno as string | number;
    if (typeof o.syscall === 'string') syscall = o.syscall;
    if (typeof o.hostname === 'string') hostname = o.hostname;
    if (o.port != null) port = o.port as string | number;
    if (typeof o.address === 'string') address = o.address;
    if (o.cause) walk(o.cause, depth + 1);
  }

  walk(e, 0);
  return {
    codes: [...new Set(codes)],
    errno,
    syscall,
    hostname,
    port,
    address,
  };
}

function formatFetchDiagShort(diag: FetchDiag | undefined): string {
  if (!diag) return 'net=—';
  const c = diag.codes.length ? diag.codes.join(',') : '—';
  return `net_codes=${c} syscall=${diag.syscall ?? '—'} host=${diag.hostname ?? '—'} port=${diag.port ?? '—'} errno=${diag.errno ?? '—'}`;
}

function interpretEvolutionFetchFailure(diag: FetchDiag | undefined, errLower: string): string {
  const codes = (diag?.codes ?? []).join(' ').toLowerCase();
  const joined = `${codes} ${errLower}`;
  if (joined.includes('econnrefused')) {
    return 'HIPOTESE=evolution_offline_ou_porta — conexão recusada no TCP (API parada, porta errada, firewall). Não indica só sessão WhatsApp desconectada.';
  }
  if (joined.includes('enotfound') || joined.includes('eai_again')) {
    return 'HIPOTESE=dns_host — hostname da Evolution não resolveu; confira base_url da API cadastrada.';
  }
  if (joined.includes('etimedout') || joined.includes('und_err_connect_timeout') || errLower.includes('timeout')) {
    return 'HIPOTESE=rede_lenta_ou_api_sobrecarregada — timeout até a Evolution (instância lenta, queda intermitente ou link).';
  }
  if (joined.includes('econnreset') || joined.includes('epipe') || joined.includes('und_err_socket') || joined.includes('socket')) {
    return 'HIPOTESE=peer_fechou_conexao — API reiniciou, proxy/nginx encerrou ou Evolution em deploy.';
  }
  if (errLower.includes('certificate') || errLower.includes('cert_') || joined.includes('ssl') || joined.includes('tls')) {
    return 'HIPOTESE=tls_ssl — problema de certificado/HTTPS entre app e Evolution.';
  }
  if (errLower.includes('fetch failed')) {
    return 'HIPOTESE=rede_generica_fetch_failed — ver base_url, SSL e se o container Evolution está no ar; comparar com status no Supabase abaixo.';
  }
  return 'HIPOTESE=indefinida — ver net_codes e status Supabase.';
}

async function evolutionInstanceDbStatusLine(instanceId: string): Promise<string> {
  try {
    const { data, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name, status, updated_at')
      .eq('id', instanceId)
      .maybeSingle();
    if (error) return `supabase_inst=erro:${error.message}`;
    if (!data) return `supabase_inst=nao_encontrada id=${shortId(instanceId)}`;
    const st = String(data.status ?? 'n/a').toLowerCase();
    const hint =
      st === 'disconnected' || st === 'close' || st === 'closed'
        ? ' [CRM: sessão/desconexão já refletida no status]'
        : st === 'connected' || st === 'open' || st === 'ok'
          ? ' [CRM: status ainda “conectada” — se o erro for ECONNREFUSED/timeout, tende a ser API Evolution/rede, não só WhatsApp]'
          : '';
    return `supabase_inst nome=${data.instance_name} status=${st} atualizado=${data.updated_at ?? 'n/a'}${hint}`;
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e);
    return `supabase_inst=excecao:${msg}`;
  }
}

type EvolutionSendResult = { success: boolean; error?: string; fetchDiag?: FetchDiag };

// ─── Build Evolution Context ─────────────────────────────────────────────────

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

  const { instance: instRow, queryError: instResolveErr } = await resolveEvolutionInstanceForActivation(
    supabaseServiceRole,
    job.instance_name,
    job.user_id
  );

  if (instResolveErr || !instRow) {
    return { error: `Instância ${job.instance_name} não encontrada ou inativa` };
  }

  const instance = instRow as {
    id: string;
    apikey?: string | null;
    instance_name?: string;
    evolution_apis?: { base_url?: string } | { base_url?: string }[];
  };

  const api = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
  const baseUrl = (api as { base_url?: string })?.base_url;
  const apiKey = instance.apikey as string;

  if (!baseUrl || !apiKey) {
    return { error: 'Instância sem base_url ou apikey' };
  }

  const freshUrl = await regenerateSignedUrl(message as DbMessage);
  if (freshUrl) (message as DbMessage).attachment_url = freshUrl;

  if (message.message_type === 'ptv' && !String(message.attachment_url || '').trim()) {
    return { error: 'Mensagem PTV sem vídeo — disparo cancelado (evita envio fantasma como texto).' };
  }

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

async function sendGroupToEvolution(ctx: EvolutionContext, groupId: string): Promise<EvolutionSendResult> {
  const { baseUrl, instanceName, apiKey, message, ptvVideoPayload, isMentionAll, messageContent } = ctx;

  if (message.message_type === 'ptv' && !ptvVideoPayload) {
    return { success: false, error: 'PTV sem payload de vídeo' };
  }

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
      const rawBody = await res.text().catch(() => '');
      console.error(`[MassSend] Evolution HTTP ${res.status} ${res.statusText} | url: ${url} | body: ${rawBody.slice(0, 500)}`);

      let errMsg = '';
      try {
        const j = JSON.parse(rawBody);
        const src = j.message ?? j.response?.message ?? j.error;
        errMsg = Array.isArray(src) ? src.join('; ') : String(src || '');
      } catch {
        errMsg = rawBody.slice(0, 300);
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

    // Log sucesso com snippet da resposta
    const okBody = await res.text().catch(() => '');
    console.log(`[MassSend] Evolution OK 200 | url: ${url} | response: ${okBody.slice(0, 200)}`);
    return { success: true };
  } catch (e: any) {
    clearTimeout(tid);
    if (e.name === 'AbortError') {
      const errLine = `Timeout: Evolution não respondeu em ${EVOLUTION_FETCH_TIMEOUT_MS / 1000}s | URL: ${url} | inst: ${ctx.instanceName}`;
      console.error(`[MassSend] FETCH FALHOU (timeout): ${errLine}`);
      return { success: false, error: errLine, fetchDiag: collectFetchDiagnostics(e) };
    }
    const cause = extractErrorCause(e);
    const fetchDiag = collectFetchDiagnostics(e);
    const detail = [
      e.message || 'Erro de rede',
      cause ? `causa: ${cause}` : null,
      formatFetchDiagShort(fetchDiag),
      `url: ${url}`,
      `inst: ${ctx.instanceName}`,
      `instance_id: ${ctx.instanceId}`,
    ].filter(Boolean).join(' | ');
    console.error(`[MassSend] FETCH FALHOU: ${detail}`);
    return { success: false, error: detail, fetchDiag };
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

// ─── Idempotência: grupos já com sucesso em activation_mass_send_job_groups ───

async function loadSucceededGroupIds(jobId: string): Promise<Set<string>> {
  const { data } = await supabaseServiceRole
    .from('activation_mass_send_job_groups')
    .select('group_id')
    .eq('job_id', jobId)
    .eq('success', true);
  return new Set((data ?? []).map((r: { group_id: string }) => String(r.group_id || '').trim()).filter(Boolean));
}

// ─── Persistir resultado de um grupo ──────────────────────────────────────────
/** `result === null`: só avança índice (grupo já tinha sucesso — não reenvia, não duplica contagem). */
async function persistGroupResult(
  jobId: string,
  groupId: string,
  result: EvolutionSendResult | null,
  newProcessedIndex: number,
  expectedProcessedIndex: number,
  isComplete: boolean
): Promise<boolean> {
  const now = new Date().toISOString();
  const skipOutcomes = result === null;
  const outcome = skipOutcomes
    ? null
    : [{ groupId, success: result.success, ...(result.error ? { error: result.error } : {}) }];

  const { data: rpcApplied, error: rpcErr } = await supabaseServiceRole.rpc('increment_mass_send_job_counts', {
    p_job_id: jobId,
    p_sent: skipOutcomes ? 0 : result.success ? 1 : 0,
    p_failed: skipOutcomes ? 0 : result.success ? 0 : 1,
    p_processed_index: newProcessedIndex,
    p_expected_processed_index: expectedProcessedIndex,
    p_last_error: skipOutcomes ? null : result.error || null,
    p_status: isComplete ? 'completed' : 'processing',
    p_now: now,
    p_group_outcomes: outcome,
  });

  if (!rpcErr && rpcApplied === true) return true;
  if (!rpcErr && rpcApplied === false) {
    console.warn(
      `[MassSend] persist ignorado (índice já avançado por outro worker) job=${shortId(jobId)} esperado=${expectedProcessedIndex}`
    );
    return false;
  }

  console.error(`[MassSend] RPC falhou — fallback com CAS:`, rpcErr?.message);
  const { data: fbRows, error: fbErr } = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({
      processed_index: newProcessedIndex,
      status: isComplete ? 'completed' : 'processing',
      updated_at: now,
      ...(isComplete ? { locked_at: null, locked_by: null } : { locked_at: now }),
    })
    .eq('id', jobId)
    .eq('processed_index', expectedProcessedIndex)
    .select('id');

  if (fbErr || !fbRows?.length) {
    console.warn(`[MassSend] fallback CAS falhou job=${shortId(jobId)} esperado=${expectedProcessedIndex}`);
    return false;
  }
  // RPC indisponível mas o job avançou: sem esta linha o grupo não entra em job_groups e o próximo worker reenvia.
  if (result !== null) {
    const { error: upErr } = await supabaseServiceRole.from('activation_mass_send_job_groups').upsert(
      {
        job_id: jobId,
        group_id: String(groupId).trim(),
        success: result.success,
        error_message: result.error ? String(result.error).slice(0, 2000) : null,
        updated_at: now,
        created_at: now,
      },
      { onConflict: 'job_id,group_id' }
    );
    if (upErr) console.warn(`[MassSend] fallback upsert job_groups: ${upErr.message}`);
  }
  return true;
}

// ─── Reconcilia contadores finais a partir da tabela de grupos ────────────────

async function reconcileFinalCounts(jobId: string): Promise<void> {
  const { data: rows } = await supabaseServiceRole
    .from('activation_mass_send_job_groups')
    .select('success')
    .eq('job_id', jobId);

  if (!Array.isArray(rows) || rows.length === 0) return;

  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.success === true) sent++;
    else failed++;
  }

  await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({
      sent_count: sent,
      failed_count: failed,
      status: 'completed',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  console.log(`[MassSend] Job ${jobId.slice(0, 8)} RECONCILIADO: ${sent} OK, ${failed} falha (${rows.length} total)`);
}

// ─── Constante de budget por invocação ────────────────────────────────────────

/** Budget por API call — margem para timeout ~60s do gateway. */
const CALL_BUDGET_MS = 45_000;
/** Intervalo mínimo entre grupos (ritmo estável sem pausas artificiais). */
const INTER_GROUP_DELAY_MS = 500;
/** Checagem de pausa no DB a cada N iterações (a RPC renova locked_at a cada grupo). */
const PAUSE_POLL_EVERY = 5;

// ─── Orquestrador: processa MÚLTIPLOS grupos por chamada (budget 40s) ────────

export async function executeMassSendProcess(_publicOrigin?: string | null): Promise<ApiResponse> {
  const callStart = Date.now();
  const lockExpired = new Date(Date.now() - LOCK_TTL_MS).toISOString();

  // 1. Busca próximo job pendente/processing com lock disponível
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
  let currentIndex = Number(job.processed_index) || 0;
  const total = groupIds.length;

  // Já terminou? Reconcilia contadores e marca completo.
  if (currentIndex >= total) {
    await reconcileFinalCounts(job.id);
    return { success: true, data: { processed: true, job_id: job.id, status: 'completed' } };
  }

  // 2. Adquire lock UMA VEZ
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
    return { success: true, data: { processed: false, message: 'Job locked por outro worker' } };
  }

  // 3. Checa pausa
  const { data: freshJob } = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .select('status')
    .eq('id', job.id)
    .single();

  if (freshJob?.status === 'paused') {
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    console.log(`[MassSend] Job ${shortId(job.id)} [${currentIndex + 1}/${total}] PAUSADO`);
    return { success: true, data: { processed: true, job_id: job.id, status: 'paused' } };
  }

  // 4. Build context UMA VEZ (mensagem + instância)
  const ctxResult = await buildEvolutionContext(job);
  if ('error' in ctxResult) {
    console.error(`[MassSend] Job ${shortId(job.id)} erro contexto: ${ctxResult.error}`);
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ status: 'failed', last_error: ctxResult.error, locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return { success: false, error: ctxResult.error };
  }

  const { ctx } = ctxResult;
  console.log(`[MassSend] Job ${shortId(job.id)} | Evolution: ${ctx.baseUrl} | tipo: ${ctx.message.message_type} | grupos: ${currentIndex + 1}-?/${total}`);

  /** Grupos que já têm linha em job_groups com success=true — não reenvia (idempotência / duplicata na lista). */
  const succeededGroupIds = await loadSucceededGroupIds(job.id);

  // 5. Loop: processa grupos enquanto tiver budget
  let totalSent = 0;
  let totalFailed = 0;
  let paused = false;
  let loopTick = 0;
  let lastLockTouchMs = Date.now();
  const retryDelays = [3_000, 5_000];

  while (currentIndex < total && (Date.now() - callStart) < CALL_BUDGET_MS) {
    const { data: idxSnap } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('processed_index')
      .eq('id', job.id)
      .maybeSingle();
    const dbIdx = Number(idxSnap?.processed_index) || 0;
    if (dbIdx !== currentIndex) {
      console.warn(`[MassSend] índice realinhado DB=${dbIdx} local=${currentIndex} job=${shortId(job.id)}`);
      currentIndex = dbIdx;
      if (currentIndex >= total) break;
    }

    const groupId = groupIds[currentIndex];

    // Delay 1s entre grupos (a partir do 2º nesta call)
    if (currentIndex > (Number(job.processed_index) || 0)) {
      await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
    }

    if (loopTick % PAUSE_POLL_EVERY === 0) {
      const { data: pauseCheck } = await supabaseServiceRole
        .from('activation_mass_send_jobs')
        .select('status')
        .eq('id', job.id)
        .single();

      if (pauseCheck?.status === 'paused') {
        console.log(`[MassSend] [${currentIndex + 1}/${total}] PAUSADO pelo usuario`);
        paused = true;
        break;
      }
    }

    if (Date.now() - lastLockTouchMs >= LOCK_HEARTBEAT_MS) {
      const hb = new Date().toISOString();
      await supabaseServiceRole
        .from('activation_mass_send_jobs')
        .update({ locked_at: hb, updated_at: hb })
        .eq('id', job.id)
        .eq('locked_by', 'mass-send-worker');
      lastLockTouchMs = Date.now();
    }

    let alreadyOk = succeededGroupIds.has(groupId);
    if (!alreadyOk) {
      const inDb = await hasMassSendGroupAlreadySucceeded(supabaseServiceRole, job.id, groupId);
      if (inDb) {
        alreadyOk = true;
        succeededGroupIds.add(groupId);
      }
    }
    let result: EvolutionSendResult;

    if (alreadyOk) {
      console.log(
        `[MassSend] [${currentIndex + 1}/${total}] ${groupId} PULAR — já consta envio com sucesso (idempotente; evita duplicar disparo)`
      );
      result = { success: true };
    } else {
      // Envia para Evolution (com retry)
      const t0 = Date.now();
      result = await sendGroupToEvolution(ctx, groupId);

      for (
        let attempt = 0;
        attempt < retryDelays.length && !result.success && isMassSendTransientRetryable(result.error);
        attempt++
      ) {
        const delay = retryDelays[attempt];
        const dbSnap = await evolutionInstanceDbStatusLine(ctx.instanceId);
        const errLower = String(result.error || '').toLowerCase();
        const hint = interpretEvolutionFetchFailure(result.fetchDiag, errLower);
        const tech = formatFetchDiagShort(result.fetchDiag);
        console.warn(
          `[MassSend] [${currentIndex + 1}/${total}] ${groupId} retry ${attempt + 1}/${retryDelays.length} em ${delay / 1000}s | ${hint} | ${tech} | ${dbSnap} | erro="${String(result.error || '').slice(0, 280)}"`
        );
        await new Promise((r) => setTimeout(r, delay));
        result = await sendGroupToEvolution(ctx, groupId);
      }

      const duration = Date.now() - t0;
      if (result.success) {
        console.log(`[MassSend] [${currentIndex + 1}/${total}] ${groupId} OK (${duration}ms)`);
        totalSent++;
        succeededGroupIds.add(groupId);
      } else {
        const dbSnap = await evolutionInstanceDbStatusLine(ctx.instanceId);
        const hint = interpretEvolutionFetchFailure(result.fetchDiag, String(result.error || '').toLowerCase());
        console.error(
          `[MassSend] [${currentIndex + 1}/${total}] ${groupId} FALHA (${duration}ms) | ${hint} | ${dbSnap} | erro="${String(result.error || '').slice(0, 300)}"`
        );
        totalFailed++;
      }
    }

    const newIdx = currentIndex + 1;
    const isComplete = newIdx >= total;

    // Persiste: null result no RPC = só avança índice sem nova linha/contagem (já havia sucesso para esse grupo)
    const persisted = await persistGroupResult(
      job.id,
      groupId,
      alreadyOk ? null : result,
      newIdx,
      currentIndex,
      isComplete
    );
    lastLockTouchMs = Date.now();

    if (!persisted) {
      const { data: snap } = await supabaseServiceRole
        .from('activation_mass_send_jobs')
        .select('processed_index')
        .eq('id', job.id)
        .maybeSingle();
      currentIndex = Number(snap?.processed_index) || 0;
      loopTick++;
      continue;
    }

    // Se completou, reconcilia
    if (isComplete) {
      await reconcileFinalCounts(job.id);
      console.log(`[MassSend] Job ${shortId(job.id)} COMPLETO: ${totalSent} OK, ${totalFailed} falha`);
      return {
        success: true,
        data: { processed: true, job_id: job.id, sent: totalSent, failed: totalFailed, current_index: newIdx, total, status: 'completed' },
      };
    }

    currentIndex = newIdx;
    loopTick++;
  }

  // 6. Libera lock (há mais grupos ou pausa — próxima invocação pode assumir)
  const hasMore = !paused && currentIndex < total;
  await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  const elapsed = ((Date.now() - callStart) / 1000).toFixed(1);
  console.log(`[MassSend] Job ${shortId(job.id)} lote: ${totalSent} OK, ${totalFailed} falha | ${elapsed}s | ate ${currentIndex}/${total}${paused ? ' | PAUSADO' : ''}${hasMore ? ' | mais pendente (chain na route)' : ''}`);

  return {
    success: true,
    data: {
      processed: true,
      job_id: job.id,
      sent: totalSent,
      failed: totalFailed,
      current_index: currentIndex,
      total,
      status: paused ? 'paused' : 'processing',
      ...(hasMore ? { more_pending: true } : {}),
    },
  };
}
