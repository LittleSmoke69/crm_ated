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

export const dynamic = 'force-dynamic';
/** Alinhado ao teto prático de funções na Netlify; o lote é pequeno para caber no tempo. */
export const maxDuration = 60;

/** Grupos por lote: paralelismo razoável sem sobrecarregar a Evolution API. */
const BATCH_SIZE = 8;
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min

const HEARTBEAT_MS = 8000;

/** Remove HTML de erro de proxy (ex.: Inactivity Timeout) para não inflar last_error no banco. */
function sanitizeWorkerError(raw: string | null, maxLen = 500): string | null {
  if (!raw || typeof raw !== 'string') return raw;
  const t = raw.trim();
  if (t.startsWith('<') || /inactivity\s*timeout/i.test(t)) {
    return 'Timeout ou resposta inválida do proxy/servidor durante o envio do lote. Tente reduzir grupos ou verifique a Evolution API.';
  }
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

async function executeMassSendProcess(): Promise<ApiResponse> {
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
    return { success: true, data: { processed: false, message: 'Nenhum job pendente' } };
  }

  const groupIds = Array.isArray(job.group_ids) ? job.group_ids : [];
  const start = Number(job.processed_index) || 0;
  const batch = groupIds.slice(start, start + BATCH_SIZE);
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
  if (sendRes.ok) {
    const json = await sendRes.json();
    sent = json?.data?.success ?? 0;
    failed = json?.data?.failed ?? 0;
    if (Array.isArray(json?.data?.errors) && json.data.errors.length > 0) {
      lastError = json.data.errors[json.data.errors.length - 1]?.error ?? null;
    }
  } else {
    const text = await sendRes.text();
    lastError = sanitizeWorkerError(text || `HTTP ${sendRes.status}`);
    failed = batch.length;
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
