/**
 * POST /api/crm/activations/mass-send/process
 * Autenticação: header x-internal-cron-secret = CRON_SECRET.
 *
 * Processa o próximo job elegível: envia grupos em SEQUÊNCIA (processed_index),
 * até CALL_BUDGET_MS por chamada. Streaming + heartbeat evita 504 no Netlify.
 * Delays longos entre grupos usam `next_group_eligible_at` + `schedule_followup_ms` (não sleep de minutos na request).
 * Com trabalho restante (`more_pending`), follow-up via after() com delay configurável.
 * Idempotente: lock + RPC com índice esperado; não reenvia grupos já com sucesso.
 */
import { NextRequest, after } from 'next/server';
import { errorResponse } from '@/lib/utils/response';
import { executeMassSendProcess } from '@/lib/crm/mass-send-process-core';
import { triggerMassSendProcessFromOrigin } from '@/lib/crm/trigger-mass-send-process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 5_000;
const CHAIN_FOLLOWUP_MS = 4_500;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-cron-secret');
  if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return errorResponse('Não autorizado', 401);
  }

  const publicOrigin = req.nextUrl?.origin || new URL(req.url).origin;
  /** Backup único após fechar a resposta (evita POST duplicado imediato + after + finally). */
  const chainState = { morePending: false, scheduleFollowupMs: null as number | null };
  let afterRegistered = false;
  try {
    after(() => {
      if (chainState.morePending) {
        const ms = chainState.scheduleFollowupMs ?? CHAIN_FOLLOWUP_MS;
        setTimeout(() => triggerMassSendProcessFromOrigin(publicOrigin), ms);
      }
    });
    afterRegistered = true;
  } catch {
    /* contexto sem after() — backup no fechamento do stream */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* cliente desconectou ou controller já fechado (heartbeat) */
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(' '));
      }, HEARTBEAT_MS);

      try {
        const payload = await executeMassSendProcess(publicOrigin);
        const data =
          payload.success && payload.data && typeof payload.data === 'object'
            ? (payload.data as Record<string, unknown>)
            : null;
        if (data?.more_pending === true && publicOrigin) {
          chainState.morePending = true;
          const sched = (data as { schedule_followup_ms?: unknown }).schedule_followup_ms;
          if (typeof sched === 'number' && sched > 0 && Number.isFinite(sched)) {
            chainState.scheduleFollowupMs = Math.min(Math.floor(sched), 86_400_000);
          }
        }
        clearInterval(heartbeat);
        safeEnqueue(encoder.encode(JSON.stringify(payload)));
      } catch (e: unknown) {
        clearInterval(heartbeat);
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already closed|Invalid state/i.test(msg)) {
          console.error('[MassSend] process route — exceção:', msg);
        }
        const fallback = { success: false, data: { processed: false, message: `Erro interno: ${msg}` } };
        safeEnqueue(encoder.encode(JSON.stringify(fallback)));
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
        if (chainState.morePending && !afterRegistered) {
          const ms = chainState.scheduleFollowupMs ?? CHAIN_FOLLOWUP_MS;
          setTimeout(() => triggerMassSendProcessFromOrigin(publicOrigin), ms);
        }
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
}
