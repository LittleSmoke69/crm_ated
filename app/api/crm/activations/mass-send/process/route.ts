/**
 * POST /api/crm/activations/mass-send/process
 * Processa campanhas de disparo em massa (cron Netlify + trigger após criar campanha).
 * Vários lotes por invocação (loop interno) para respeitar delay entre grupos sem esperar 1 min.
 */
import { NextRequest } from 'next/server';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { executeMassSendProcess } from '@/lib/crm/mass-send-process-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HEARTBEAT_MS = 8000;

/** Entre rodadas de `executeMassSendProcess` quando a fila ainda tem trabalho (cron real ≥1 min no Netlify). */
function resolveMassSendFollowUpPollMs(): number {
  const raw = process.env.MASS_SEND_FOLLOW_UP_POLL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2000;
  return Math.min(30_000, Math.max(500, Math.floor(n)));
}

/** Teto da requisição inteira (várias rodadas), abaixo de maxDuration. */
const MASS_SEND_REQUEST_BUDGET_MS = 115_000;

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
          const publicOrigin = req.nextUrl?.origin || new URL(req.url).origin;
          const pollMs = resolveMassSendFollowUpPollMs();
          const requestDeadline = Date.now() + MASS_SEND_REQUEST_BUDGET_MS;
          let payload = await executeMassSendProcess(publicOrigin);
          while (
            (payload.data as Record<string, unknown> | undefined)?.more_pending === true &&
            Date.now() < requestDeadline
          ) {
            await new Promise((r) => setTimeout(r, pollMs));
            payload = await executeMassSendProcess(publicOrigin);
          }
          const out = payload.data as Record<string, unknown> | undefined;
          if (out?.more_pending) {
            out.more_pending = false;
            out.follow_up_deferred = true;
            out.message =
              typeof out.message === 'string'
                ? `${out.message} (continua no próximo poll; orçamento de tempo da requisição).`
                : 'Fila ainda tinha trabalho; continua no próximo poll ou cron.';
          }
          if (out && 'more_pending' in out) delete out.more_pending;
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
