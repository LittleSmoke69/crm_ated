/**
 * Worker de campanhas de disparo em massa (ativações).
 * Usado pela rota POST /api/crm/activations/mass-send/process.
 * Loop interno: vários lotes na mesma invocação (cron Netlify roda no máx. 1/min).
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import type { ApiResponse } from '@/lib/utils/response';

/** Delay aleatório entre 1s e 2s entre grupos para parecer mais natural. */
const INTER_GROUP_DELAY_MIN_MS = 1_000;
const INTER_GROUP_DELAY_MAX_MS = 2_000;
const LOCK_TTL_MS = 4 * 60 * 1000;

/** Tempo máximo do loop interno por chamada HTTP (deixa margem ao maxDuration da rota). */
const INNER_LOOP_BUDGET_MS = 110_000;
const MAX_INNER_STEPS = 40;

function buildBatchGroupOutcomes(
  batch: string[],
  json: { data?: Record<string, unknown> } | null,
  fallbackError: string | null
): { groupId: string; success: boolean; error?: string }[] {
  if (fallbackError) {
    const safe = sanitizeMassSendErrorMessage(fallbackError) || fallbackError.slice(0, 200);
    return batch.map((groupId) => ({ groupId, success: false, error: safe }));
  }
  const data = json?.data as Record<string, unknown> | undefined;
  const rawOutcomes = data?.groupOutcomes;
  if (Array.isArray(rawOutcomes) && rawOutcomes.length > 0) {
    return rawOutcomes
      .map((o: unknown) => {
        const row = o as { groupId?: string; group_id?: string; success?: boolean; error?: string };
        const groupId = String(row.groupId ?? row.group_id ?? '').trim();
        if (!groupId) return null;
        const em = row.error ? String(row.error) : '';
        return {
          groupId,
          success: row.success === true,
          ...(em ? { error: sanitizeMassSendErrorMessage(em) || em.slice(0, 200) } : {}),
        };
      })
      .filter(Boolean) as { groupId: string; success: boolean; error?: string }[];
  }
  const errors = Array.isArray(data?.errors) ? (data.errors as { groupId?: string; error?: string }[]) : [];
  return batch.map((groupId) => {
    const err = errors.find((e) => e.groupId === groupId);
    if (!err) return { groupId, success: true };
    const msg = String(err.error ?? '');
    return { groupId, success: false, error: sanitizeMassSendErrorMessage(msg) || msg.slice(0, 200) };
  });
}

export type MassSendStepHint = 'stop' | 'retry_lock' | 'continue';

export type MassSendSingleStepResult = {
  response: ApiResponse;
  hint: MassSendStepHint;
};

function resolvePublicSiteUrl(publicOrigin?: string | null): string {
  const fromReq = publicOrigin?.trim().replace(/\/$/, '');
  if (fromReq) return fromReq;
  const fromEnv =
    process.env.URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://localhost:3000';
}

/**
 * Um passo: lock → (opcional pausa se delay e já houve envios) → POST interno /send → RPC.
 * @param publicOrigin — ex.: req.nextUrl.origin da chamada a /process (evita fetch em localhost errado no servidor).
 */
export async function massSendProcessSingleStep(publicOrigin?: string | null): Promise<MassSendSingleStepResult> {
  const now = new Date().toISOString();
  const lockExpired = new Date(Date.now() - LOCK_TTL_MS).toISOString();

  const { data: jobs } = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .select('id, user_id, message_id, instance_name, group_ids, total_groups, processed_index, status')
    .in('status', ['pending', 'processing'])
    .or(`locked_at.is.null,locked_at.lt.${lockExpired}`)
    .order('created_at', { ascending: true })
    .limit(1);

  const job = jobs?.[0];
  if (!job) {
    return {
      response: { success: true, data: { processed: false, message: 'Nenhum job pendente' } },
      hint: 'stop',
    };
  }

  const groupIds = Array.isArray(job.group_ids) ? job.group_ids : [];
  const start = Number(job.processed_index) || 0;
  // Um grupo por passo — delay fixo de 2s entre eles garante estabilidade na instância.
  const batch = groupIds.slice(start, start + 1);

  if (batch.length === 0) {
    await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ status: 'completed', locked_at: null, locked_by: null, updated_at: now })
      .eq('id', job.id);
    return {
      response: {
        success: true,
        data: { processed: true, job_id: job.id, status: 'completed' },
      },
      hint: 'stop',
    };
  }

  const locked = await supabaseServiceRole
    .from('activation_mass_send_jobs')
    .update({
      status: 'processing',
      locked_at: now,
      locked_by: 'mass-send-process',
      updated_at: now,
    })
    .eq('id', job.id)
    .eq('status', job.status)
    .or('locked_at.is.null,locked_at.lt.' + lockExpired)
    .select('id')
    .single();

  if (locked.error || !locked.data) {
    return {
      response: {
        success: true,
        data: { processed: false, message: 'Job já em processamento' },
      },
      hint: 'retry_lock',
    };
  }

  // Delay fixo de 2s entre grupos (a partir do 2º) para não sobrecarregar a instância.
  if (start > 0) {
    const delay = INTER_GROUP_DELAY_MIN_MS + Math.random() * (INTER_GROUP_DELAY_MAX_MS - INTER_GROUP_DELAY_MIN_MS);
    await new Promise((r) => setTimeout(r, delay));
  }

  const siteUrl = resolvePublicSiteUrl(publicOrigin);
  const sendUrl = `${siteUrl}/api/crm/activations/send`;

  const doSend = () =>
    fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-cron-secret': process.env.CRON_SECRET ?? '',
        'x-user-id': job.user_id,
      },
      body: JSON.stringify({
        messageId: job.message_id,
        groupIds: batch,
        instanceName: job.instance_name,
        forceSync: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });

  let sendRes: Response;
  try {
    sendRes = await doSend();
    // Retry automático para erros transientes (502/503/504).
    if (sendRes.status >= 502 && sendRes.status <= 504) {
      console.warn(`[MASS-SEND] HTTP ${sendRes.status} no grupo ${batch[0]} — retry em 3s`);
      await new Promise((r) => setTimeout(r, 3_000));
      sendRes = await doSend();
    }
  } catch (firstErr) {
    // TypeError: fetch failed — retry uma vez após 3s.
    console.warn(`[MASS-SEND] fetch falhou no grupo ${batch[0]} — retry em 3s:`, (firstErr as Error).message);
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      sendRes = await doSend();
    } catch (retryErr) {
      // Falha definitiva: registra erro e continua.
      const errMsg = `Falha de rede ao enviar (${(retryErr as Error).message}). Verifique a conexão.`;
      const batchOutcomesFail = buildBatchGroupOutcomes(batch, null, errMsg);
      const newIdx = start + batch.length;
      const done = newIdx >= groupIds.length;
      await supabaseServiceRole.rpc('increment_mass_send_job_counts', {
        p_job_id: job.id, p_sent: 0, p_failed: batch.length,
        p_processed_index: newIdx, p_last_error: errMsg,
        p_status: done ? 'completed' : 'processing',
        p_now: new Date().toISOString(),
        p_group_outcomes: batchOutcomesFail.length > 0 ? batchOutcomesFail : null,
      }).then(({ error: rpcE }) => {
        if (rpcE) {
          // Fallback direto se RPC falhar.
          return supabaseServiceRole.from('activation_mass_send_jobs').update({
            processed_index: newIdx, status: done ? 'completed' : 'processing',
            locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }
      });
      return {
        response: { success: true, data: { processed: true, job_id: job.id, batch_size: batch.length, sent: 0, failed: batch.length, status: done ? 'completed' : 'processing' } },
        hint: done ? 'stop' : 'continue',
      };
    }
  }

  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;
  let batchOutcomes: { groupId: string; success: boolean; error?: string }[] = [];

  if (sendRes.ok) {
    const json = (await sendRes.json()) as { data?: Record<string, unknown> };
    sent = (json?.data?.success as number) ?? 0;
    failed = (json?.data?.failed as number) ?? 0;
    if (Array.isArray(json?.data?.errors) && (json.data.errors as unknown[]).length > 0) {
      const errs = json.data.errors as { error?: string }[];
      const raw = String(errs[errs.length - 1]?.error ?? '');
      lastError = raw ? sanitizeMassSendErrorMessage(raw) || null : null;
    }
    batchOutcomes = buildBatchGroupOutcomes(batch, json, null);
    if (batchOutcomes.length !== batch.length) {
      batchOutcomes = batch.map((groupId) => {
        const errs = Array.isArray(json?.data?.errors)
          ? (json.data.errors as { groupId?: string; error?: string }[])
          : [];
        const err = errs.find((e) => e.groupId === groupId);
        if (!err) return { groupId, success: true };
        const msg = String(err.error ?? '');
        return { groupId, success: false, error: sanitizeMassSendErrorMessage(msg) || msg.slice(0, 200) };
      });
    }
  } else {
    const text = await sendRes.text();
    lastError =
      sanitizeMassSendErrorMessage(text) ||
      `Falha ao chamar o envio (HTTP ${sendRes.status}). Verifique a aplicação e o proxy.`;
    failed = batch.length;
    batchOutcomes = buildBatchGroupOutcomes(batch, null, lastError);
  }

  const newProcessedIndex = start + batch.length;
  // Usa groupIds.length como fonte de verdade para evitar job incompleto quando total_groups diverge.
  const isComplete = newProcessedIndex >= groupIds.length;

  const { error: rpcErr } = await supabaseServiceRole.rpc('increment_mass_send_job_counts', {
    p_job_id: job.id,
    p_sent: sent,
    p_failed: failed,
    p_processed_index: newProcessedIndex,
    p_last_error: lastError,
    p_status: isComplete ? 'completed' : 'processing',
    p_now: new Date().toISOString(),
    p_group_outcomes: batchOutcomes.length > 0 ? batchOutcomes : null,
  });

  if (rpcErr) {
    console.error('[MASS-SEND] RPC increment_mass_send_job_counts falhou — tentando fallback direto:', rpcErr.message);
    // Fallback: avança processed_index mesmo sem o RPC para evitar re-envio infinito do mesmo grupo.
    const { error: fallbackErr } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({
        processed_index: newProcessedIndex,
        status: isComplete ? 'completed' : 'processing',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (fallbackErr) {
      console.error('[MASS-SEND] Fallback direto também falhou — liberando lock sem avançar:', fallbackErr.message);
      await supabaseServiceRole
        .from('activation_mass_send_jobs')
        .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      return {
        response: { success: false, error: 'Erro interno ao salvar resultado do grupo. Será reprocessado.' },
        hint: 'retry_lock',
      };
    }

    // Fallback ok: processed_index avançou — continua normalmente sem reprocessar o mesmo grupo.
    return {
      response: {
        success: true,
        data: {
          processed: true,
          job_id: job.id,
          batch_size: batch.length,
          sent,
          failed,
          status: isComplete ? 'completed' : 'processing',
          rpc_fallback: true,
        },
      },
      hint: isComplete ? 'stop' : 'continue',
    };
  }

  const response: ApiResponse = {
    success: true,
    data: {
      processed: true,
      job_id: job.id,
      batch_size: batch.length,
      sent,
      failed,
      status: isComplete ? 'completed' : 'processing',
    },
  };

  return {
    response,
    hint: isComplete ? 'stop' : 'continue',
  };
}

/**
 * Vários lotes na mesma requisição (cron Netlify ≥1 min; `more_pending` permite polling em segundos no caller).
 */
export async function executeMassSendProcess(publicOrigin?: string | null): Promise<ApiResponse> {
  const budgetEnd = Date.now() + INNER_LOOP_BUDGET_MS;
  let last: ApiResponse = {
    success: true,
    data: { processed: false, message: 'Nenhum job pendente' },
  };
  let steps = 0;
  let lastHint: MassSendStepHint = 'stop';

  while (Date.now() < budgetEnd && steps < MAX_INNER_STEPS) {
    steps++;
    const { response, hint } = await massSendProcessSingleStep(publicOrigin);
    last = response;
    lastHint = hint;

    if (hint === 'stop') break;
    if (hint === 'retry_lock') {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (hint === 'continue') continue;
  }

  const d = last.data as Record<string, unknown> | undefined;
  const status = d?.status;
  const morePending =
    lastHint === 'continue' ||
    lastHint === 'retry_lock' ||
    (d?.processed === true && status === 'processing');

  if (morePending && d && typeof d === 'object') {
    d.more_pending = true;
  } else if (d && typeof d === 'object' && 'more_pending' in d) {
    delete d.more_pending;
  }

  return last;
}
