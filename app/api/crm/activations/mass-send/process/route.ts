/**
 * POST /api/crm/activations/mass-send/process
 * Processa um lote de uma campanha de disparo em massa (chamado pelo cron Netlify).
 * Requer header x-internal-cron-secret = CRON_SECRET.
 *
 * Envia bytes periódicos (heartbeat) na resposta enquanto aguarda o /send, para proxies
 * não encerrarem a conexão por inatividade ("Inactivity Timeout" / idle timeout).
 */
import { NextRequest } from 'next/server';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import type { ApiResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';

export const dynamic = 'force-dynamic';
/** Alinhado ao teto prático de funções na Netlify; o lote é pequeno para caber no tempo. */
export const maxDuration = 60;

/** Grupos por lote: paralelismo razoável sem sobrecarregar a Evolution API. */
const BATCH_SIZE = 8;
/** Com pausa entre disparos (inter_group_delay_ms > 0 no job), um grupo por chamada a /send. */
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min

const HEARTBEAT_MS = 8000;

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

async function executeMassSendProcess(): Promise<ApiResponse> {
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
    return { success: true, data: { processed: false, message: 'Nenhum job pendente' } };
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
    return { success: true, data: { processed: true, job_id: job.id, status: 'completed' } };
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
    return { success: true, data: { processed: false, message: 'Job já em processamento' } };
  }

  if (delayMs > 0 && start > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const base =
    process.env.URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'http://localhost:3000';
  const siteUrl = base.replace(/\/$/, '');
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

  // Usa RPC para incremento atômico — evita race condition de read-modify-write
  // quando dois workers executam o mesmo job simultaneamente.
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

  return {
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
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-internal-cron-secret');
    if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
      return errorResponse('Não autorizado', 401);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(' '));
          } catch {
            /* stream já fechado */
          }
        }, HEARTBEAT_MS);

        try {
          const payload = await executeMassSendProcess();
          clearInterval(heartbeat);
          controller.enqueue(encoder.encode(JSON.stringify(payload)));
        } catch (e) {
          clearInterval(heartbeat);
          const res = serverErrorResponse(e);
          const errJson = await res.json();
          controller.enqueue(encoder.encode(JSON.stringify(errJson)));
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
