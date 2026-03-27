/**
 * Worker de campanhas de disparo em massa (ativações).
 * Usado pela rota POST /api/crm/activations/mass-send/process.
 * Loop interno: vários lotes na mesma invocação (cron Netlify roda no máx. 1/min).
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import type { ApiResponse } from '@/lib/utils/response';

/** Grupos por lote quando não há delay configurado. */
const BATCH_SIZE = 8;
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
    .select('id, user_id, message_id, instance_name, group_ids, total_groups, processed_index, status, inter_group_delay_ms')
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
  const rawDelay = Number((job as { inter_group_delay_ms?: number }).inter_group_delay_ms);
  const delayMs =
    Number.isFinite(rawDelay) && rawDelay > 0 ? Math.max(0, Math.min(15_000, Math.floor(rawDelay))) : 0;
  const effectiveBatchSize = delayMs > 0 ? 1 : BATCH_SIZE;
  const batch = groupIds.slice(start, start + effectiveBatchSize);

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

  // Após o 1º grupo (ex.: disparo imediato na criação), respeita o delay antes do próximo envio.
  if (delayMs > 0 && start > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const siteUrl = resolvePublicSiteUrl(publicOrigin);
  const sendUrl = `${siteUrl}/api/crm/activations/send`;

  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-cron-secret': process.env.CRON_SECRET!,
      'x-user-id': job.user_id,
    },
    body: JSON.stringify({
      messageId: job.message_id,
      groupIds: batch,
      instanceName: job.instance_name,
      forceSync: true,
      interGroupDelayMs: delayMs > 0 ? delayMs : 0,
    }),
  });

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
  const totalGroups = Number(job.total_groups) || groupIds.length;
  const isComplete = newProcessedIndex >= totalGroups;

  await supabaseServiceRole.rpc('increment_mass_send_job_counts', {
    p_job_id: job.id,
    p_sent: sent,
    p_failed: failed,
    p_processed_index: newProcessedIndex,
    p_last_error: lastError,
    p_status: isComplete ? 'completed' : 'processing',
    p_now: new Date().toISOString(),
    p_group_outcomes: batchOutcomes.length > 0 ? batchOutcomes : null,
  });

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
