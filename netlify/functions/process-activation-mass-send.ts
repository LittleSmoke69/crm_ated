/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * Processa campanhas de disparo em massa DIRETAMENTE — sem chamar API route.
 * Timeout: 120s. Budget: 110s. Delay curto entre grupos; lock TTL alinhado ao worker Next.
 * Roda a cada 1 min via cron. Se a fila tem trabalho, processa até o budget acabar.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveEvolutionInstanceForActivation } from '../../lib/crm/resolve-evolution-instance-for-activation';
import {
  hasMassSendGroupAlreadySucceeded,
  isMassSendTransientRetryable,
} from '../../lib/crm/mass-send-group-idempotency';

// ─── Config ──────────────────────────────────────────────────────────────────

const BUDGET_MS = 110_000;
const INTER_GROUP_DELAY_MS = 500;
const EVOLUTION_TIMEOUT_MS = 30_000;
const LOCK_TTL_MS = 180_000;
const LOCK_HEARTBEAT_MS = 25_000;
const RETRY_DELAYS = [3_000, 5_000];
const PAUSE_POLL_EVERY = 5;

// ─── Supabase client (service role) ──────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE env vars missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function loadSucceededGroupIds(supabase: ReturnType<typeof getSupabase>, jobId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('activation_mass_send_job_groups')
    .select('group_id')
    .eq('job_id', jobId)
    .eq('success', true);
  return new Set((data ?? []).map((r: { group_id: string }) => String(r.group_id || '').trim()).filter(Boolean));
}

function sanitizeError(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('<') || /<html/i.test(raw)) return 'Gateway retornou HTML (502/503/504)';
  return raw.length > 400 ? raw.slice(0, 400) + '…' : raw;
}

// ─── Evolution API send ──────────────────────────────────────────────────────

type SendResult = { success: boolean; error?: string };

async function sendToEvolution(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
  groupId: string,
  msg: Record<string, unknown>
): Promise<SendResult> {
  const msgType = String(msg.message_type || '');
  const content = String(msg.content || '').trim();
  const attachUrl = String(msg.attachment_url || '');
  const attachType = String(msg.attachment_type || '');
  const attachMime = String(msg.attachment_mime || 'image/png');
  const mentionAll = msg.mention_all === true || String(msg.mention_all).toLowerCase() === 'true';
  const ptvDelay = typeof msg.ptv_delay === 'number' ? msg.ptv_delay : 1200;

  if (msgType === 'ptv' && !msg._ptvBase64) {
    return { success: false, error: 'PTV sem vídeo' };
  }

  let url: string;
  let body: Record<string, unknown>;

  if (msgType === 'ptv' && msg._ptvBase64) {
    url = `${baseUrl}/message/sendPtv/${instanceName}`;
    body = { number: groupId, video: msg._ptvBase64 as string, delay: ptvDelay };
  } else if (msgType === 'audio' && attachUrl) {
    url = `${baseUrl}/message/sendWhatsAppAudio/${instanceName}`;
    body = { number: groupId, audio: attachUrl, ...(mentionAll && { mentionsEveryOne: true }) };
  } else if (msgType === 'text_with_attachment' && attachUrl) {
    url = `${baseUrl}/message/sendMedia/${instanceName}`;
    let mediatype = 'image';
    let mimetype = attachMime;
    let fileName = 'file';
    if (attachType === 'video' || mimetype.startsWith('video/')) { mediatype = 'video'; mimetype = mimetype || 'video/mp4'; fileName = 'video.mp4'; }
    else if (attachType === 'audio') { mediatype = 'document'; mimetype = mimetype || 'audio/mpeg'; fileName = 'audio.mp3'; }
    else if (attachType === 'image') { const ext = mimetype.includes('jpeg') ? 'jpg' : 'png'; fileName = `image.${ext}`; }
    body = {
      number: groupId, mediatype, mimetype, media: attachUrl, fileName,
      ...(content ? { caption: content } : {}),
      ...(mentionAll && { mentionsEveryOne: true }),
    };
  } else {
    if (!content) return { success: false, error: 'Mensagem sem conteúdo' };
    url = `${baseUrl}/message/sendText/${instanceName}`;
    body = { number: groupId, text: content, ...(mentionAll && { mentionsEveryOne: true }) };
  }

  url = normalizeUrl(url);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);

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
      console.error(`[MassSend] Evolution HTTP ${res.status} | ${url} | body: ${text.slice(0, 300)}`);
      let errMsg = '';
      try {
        const j = JSON.parse(text);
        const src = j.message ?? j.response?.message ?? j.error;
        errMsg = Array.isArray(src) ? src.join('; ') : String(src || '');
      } catch { errMsg = text.slice(0, 300); }
      return { success: false, error: sanitizeError(errMsg) || `Erro ${res.status}` };
    }

    return { success: true };
  } catch (e: any) {
    clearTimeout(tid);
    if (e.name === 'AbortError') return { success: false, error: `Timeout ${EVOLUTION_TIMEOUT_MS / 1000}s` };
    const cause = e.cause ? ` | cause: ${e.cause?.code || e.cause?.message || JSON.stringify(e.cause).slice(0, 200)}` : '';
    const detail = `${e.message}${cause} | url: ${url}`;
    console.error(`[MassSend] FETCH FALHOU: ${detail}`);
    return { success: false, error: detail };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  const startTime = Date.now();
  const supabase = getSupabase();
  const lockExpired = new Date(Date.now() - LOCK_TTL_MS).toISOString();

  let totalSent = 0;
  let totalFailed = 0;
  let groupsProcessed = 0;

  // Loop principal: processa grupos até o budget acabar
  while (Date.now() - startTime < BUDGET_MS) {

    // 1. Busca próximo job
    const { data: jobs } = await supabase
      .from('activation_mass_send_jobs')
      .select('id, user_id, message_id, instance_name, group_ids, processed_index, status')
      .in('status', ['pending', 'processing'])
      .or(`locked_at.is.null,locked_at.lt.${lockExpired}`)
      .order('created_at', { ascending: true })
      .limit(1);

    const job = jobs?.[0];
    if (!job) {
      if (groupsProcessed > 0) console.log(`[MassSend] Fila vazia. Total: ${totalSent} OK, ${totalFailed} falha em ${groupsProcessed} grupos.`);
      break;
    }

    const groupIds = Array.isArray(job.group_ids) ? (job.group_ids as string[]) : [];
    let idx = Number(job.processed_index) || 0;
    const total = groupIds.length;

    // Já terminou?
    if (idx >= total) {
      await reconcile(supabase, job.id);
      continue;
    }

    // 2. Lock
    const now = new Date().toISOString();
    const { data: locked } = await supabase
      .from('activation_mass_send_jobs')
      .update({ status: 'processing', locked_at: now, locked_by: 'mass-send-cron', updated_at: now })
      .eq('id', job.id)
      .in('status', [job.status, 'processing'])
      .or('locked_at.is.null,locked_at.lt.' + lockExpired)
      .select('id')
      .single();

    if (!locked) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    // 3. Checa pausa
    const { data: fresh } = await supabase
      .from('activation_mass_send_jobs')
      .select('status')
      .eq('id', job.id)
      .single();

    if (fresh?.status === 'paused') {
      await supabase.from('activation_mass_send_jobs').update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      console.log(`[MassSend] Job ${shortId(job.id)} PAUSADO [${idx + 1}/${total}]`);
      break;
    }

    // 4. Build context UMA VEZ para este job
    const { data: message } = await supabase
      .from('messages')
      .select('id, content, title, message_type, attachment_url, attachment_type, attachment_mime, mention_all, ptv_delay')
      .eq('id', job.message_id)
      .single();

    if (!message) {
      await supabase.from('activation_mass_send_jobs').update({ status: 'failed', last_error: 'Mensagem não encontrada', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      console.error(`[MassSend] Job ${shortId(job.id)} mensagem ${job.message_id} não encontrada`);
      continue;
    }

    const { instance: instRow, queryError: instResolveErr } = await resolveEvolutionInstanceForActivation(
      supabase,
      job.instance_name,
      job.user_id
    );

    if (instResolveErr || !instRow) {
      await supabase.from('activation_mass_send_jobs').update({ status: 'failed', last_error: 'Instância não encontrada', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      console.error(`[MassSend] Job ${shortId(job.id)} instância ${job.instance_name} não encontrada`, instResolveErr || '');
      continue;
    }

    const instance = instRow as {
      id: string;
      apikey?: string | null;
      evolution_apis?: { base_url?: string } | { base_url?: string }[];
    };

    const api = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
    const baseUrl = normalizeUrl((api as { base_url?: string })?.base_url || '');
    const apiKey = instance.apikey as string;

    if (!baseUrl || !apiKey) {
      await supabase.from('activation_mass_send_jobs').update({ status: 'failed', last_error: 'Sem base_url ou apikey', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      continue;
    }

    // Regenera signed URL se necessário
    if (message.attachment_url && String(message.attachment_url).includes('supabase.co/storage/v1')) {
      try {
        const match = String(message.attachment_url).match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+?)(\?|$)/);
        if (match?.[1] && match?.[2]) {
          const { data: signed } = await supabase.storage.from(match[1]).createSignedUrl(decodeURIComponent(match[2]), 31536000);
          if (signed?.signedUrl) {
            message.attachment_url = signed.signedUrl;
            await supabase.from('messages').update({ attachment_url: signed.signedUrl }).eq('id', message.id);
          }
        }
      } catch { /* keep original */ }
    }

    // PTV: baixa video base64 UMA VEZ
    const msg = message as Record<string, unknown>;
    if (message.message_type === 'ptv' && message.attachment_url) {
      const v = String(message.attachment_url).trim();
      if (v.startsWith('http')) {
        try {
          const r = await fetch(v);
          const buf = await r.arrayBuffer();
          msg._ptvBase64 = Buffer.from(buf).toString('base64');
          console.log(`[MassSend] PTV base64: ${Math.round(String(msg._ptvBase64).length / 1024)}KB`);
        } catch (e: any) {
          await supabase.from('activation_mass_send_jobs').update({ status: 'failed', last_error: `PTV download: ${e.message}`, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
          continue;
        }
      } else {
        msg._ptvBase64 = v;
      }
    }

    if (message.message_type === 'ptv' && !msg._ptvBase64) {
      await supabase
        .from('activation_mass_send_jobs')
        .update({
          status: 'failed',
          last_error: 'PTV sem vídeo — campanha cancelada',
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      console.error(`[MassSend] Job ${shortId(job.id)} PTV sem payload`);
      continue;
    }

    console.log(`[MassSend] Job ${shortId(job.id)} | ${baseUrl} | tipo: ${message.message_type} | ${idx + 1}→${total}`);

    const succeededGroupIds = await loadSucceededGroupIds(supabase, job.id);

    // 5. Loop de grupos para este job
    let loopTick = 0;
    let lastLockTouchMs = Date.now();
    while (idx < total && (Date.now() - startTime) < BUDGET_MS) {
      const { data: idxSnap } = await supabase.from('activation_mass_send_jobs').select('processed_index').eq('id', job.id).maybeSingle();
      const dbIdx = Number(idxSnap?.processed_index) || 0;
      if (dbIdx !== idx) {
        console.warn(`[MassSend] índice realinhado DB=${dbIdx} local=${idx} job=${shortId(job.id)}`);
        idx = dbIdx;
        if (idx >= total) break;
      }

      const groupId = groupIds[idx];

      // Delay 1s entre grupos
      if (idx > (Number(job.processed_index) || 0)) {
        await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
      }

      if (loopTick % PAUSE_POLL_EVERY === 0) {
        const { data: pc } = await supabase.from('activation_mass_send_jobs').select('status').eq('id', job.id).single();
        if (pc?.status === 'paused') {
          console.log(`[MassSend] [${idx + 1}/${total}] PAUSADO`);
          await supabase.from('activation_mass_send_jobs').update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
          return done(startTime, groupsProcessed, totalSent, totalFailed);
        }
      }

      if (Date.now() - lastLockTouchMs >= LOCK_HEARTBEAT_MS) {
        const hb = new Date().toISOString();
        await supabase
          .from('activation_mass_send_jobs')
          .update({ locked_at: hb, updated_at: hb })
          .eq('id', job.id)
          .eq('locked_by', 'mass-send-cron');
        lastLockTouchMs = Date.now();
      }

      let alreadyOk = succeededGroupIds.has(groupId);
      if (!alreadyOk) {
        const inDb = await hasMassSendGroupAlreadySucceeded(supabase, job.id, groupId);
        if (inDb) {
          alreadyOk = true;
          succeededGroupIds.add(groupId);
        }
      }
      let result: SendResult;

      if (alreadyOk) {
        console.log(
          `[MassSend] [${idx + 1}/${total}] ${groupId} PULAR — já consta envio com sucesso (idempotente)`
        );
        result = { success: true };
      } else {
        const t0 = Date.now();
        result = await sendToEvolution(baseUrl, job.instance_name, apiKey, groupId, msg);

        for (let r = 0; r < RETRY_DELAYS.length && !result.success && isMassSendTransientRetryable(result.error); r++) {
          console.warn(`[MassSend] [${idx + 1}/${total}] ${groupId} retry ${r + 1}/${RETRY_DELAYS.length} em ${RETRY_DELAYS[r] / 1000}s | ${result.error}`);
          await new Promise((w) => setTimeout(w, RETRY_DELAYS[r]));
          result = await sendToEvolution(baseUrl, job.instance_name, apiKey, groupId, msg);
        }

        const ms = Date.now() - t0;
        if (result.success) {
          console.log(`[MassSend] [${idx + 1}/${total}] ${groupId} OK (${ms}ms)`);
          totalSent++;
          succeededGroupIds.add(groupId);
        } else {
          console.error(`[MassSend] [${idx + 1}/${total}] ${groupId} FALHA (${ms}ms) | ${result.error}`);
          totalFailed++;
        }
      }

      const newIdx = idx + 1;
      const isComplete = newIdx >= total;

      const pNow = new Date().toISOString();
      const skipRpcOutcomes = alreadyOk;
      const outcome = skipRpcOutcomes
        ? null
        : [{ groupId, success: result.success, ...(result.error ? { error: result.error } : {}) }];
      const { data: rpcApplied, error: rpcErr } = await supabase.rpc('increment_mass_send_job_counts', {
        p_job_id: job.id,
        p_sent: skipRpcOutcomes ? 0 : result.success ? 1 : 0,
        p_failed: skipRpcOutcomes ? 0 : result.success ? 0 : 1,
        p_processed_index: newIdx,
        p_expected_processed_index: idx,
        p_last_error: skipRpcOutcomes ? null : result.error || null,
        p_status: isComplete ? 'completed' : 'processing',
        p_now: pNow,
        p_group_outcomes: outcome,
      });

      let persisted = rpcApplied === true;
      if (!rpcErr && rpcApplied === false) {
        console.warn(`[MassSend] persist ignorado (corrida) job=${shortId(job.id)} esperado_idx=${idx}`);
        persisted = false;
      } else if (rpcErr) {
        console.error(`[MassSend] RPC falhou: ${rpcErr.message}`);
        const { data: fbRows, error: fbErr } = await supabase
          .from('activation_mass_send_jobs')
          .update({
            processed_index: newIdx,
            status: isComplete ? 'completed' : 'processing',
            updated_at: pNow,
            ...(isComplete ? { locked_at: null, locked_by: null } : { locked_at: pNow }),
          })
          .eq('id', job.id)
          .eq('processed_index', idx)
          .select('id');
        persisted = !fbErr && Array.isArray(fbRows) && fbRows.length > 0;
        if (!persisted) console.warn(`[MassSend] fallback CAS falhou job=${shortId(job.id)} idx=${idx}`);
        else if (!alreadyOk) {
          const { error: upErr } = await supabase.from('activation_mass_send_job_groups').upsert(
            {
              job_id: job.id,
              group_id: String(groupId).trim(),
              success: result.success,
              error_message: result.error ? String(result.error).slice(0, 2000) : null,
              updated_at: pNow,
              created_at: pNow,
            },
            { onConflict: 'job_id,group_id' }
          );
          if (upErr) console.warn(`[MassSend] fallback upsert job_groups: ${upErr.message}`);
        }
      }

      lastLockTouchMs = Date.now();

      if (!persisted) {
        const { data: snap } = await supabase.from('activation_mass_send_jobs').select('processed_index').eq('id', job.id).maybeSingle();
        idx = Number(snap?.processed_index) || 0;
        loopTick++;
        continue;
      }

      if (isComplete) {
        await reconcile(supabase, job.id);
        console.log(`[MassSend] Job ${shortId(job.id)} COMPLETO: ${totalSent} OK, ${totalFailed} falha`);
      }

      idx = newIdx;
      groupsProcessed++;
      loopTick++;
    }

    // Libera lock se não completou — devolve ao Next e encerra esta invocação (evita re-adquirir o mesmo job no mesmo tick e competir com os POSTs disparados)
    if (idx < total) {
      await supabase.from('activation_mass_send_jobs').update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      console.log(`[MassSend] Job ${shortId(job.id)} budget esgotado em ${idx}/${total}. Auto-chain + próximo cron.`);
      triggerMassSendWorkerFromDeployUrl();
      return done(startTime, groupsProcessed, totalSent, totalFailed);
    }
  }

  return done(startTime, groupsProcessed, totalSent, totalFailed);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcile(supabase: any, jobId: string) {
  const { data: rows } = await supabase.from('activation_mass_send_job_groups').select('success').eq('job_id', jobId);
  if (!Array.isArray(rows) || rows.length === 0) return;
  let s = 0, f = 0;
  for (const r of rows) { if (r.success === true) s++; else f++; }
  await supabase.from('activation_mass_send_jobs').update({
    sent_count: s, failed_count: f, status: 'completed', locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
  }).eq('id', jobId);
  console.log(`[MassSend] Job ${shortId(jobId)} RECONCILIADO: ${s} OK, ${f} falha (${rows.length} total)`);
}

function done(startTime: number, groups: number, sent: number, failed: number) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[MassSend] Cron concluído: ${groups} grupos em ${elapsed}s | ${sent} OK, ${failed} falha`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, groups, sent, failed, elapsed_s: elapsed }) };
}

/** Encadeia o worker Next (mesmo fluxo do CRM) quando ainda há fila — não depende só do próximo minuto do cron. */
function triggerMassSendWorkerFromDeployUrl(): void {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
  if (!secret || !base) return;
  const processUrl = `${base}/api/crm/activations/mass-send/process`;
  void fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-cron-secret': secret,
    },
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[MassSend] Auto-chain process falhou:', msg);
  });
}
