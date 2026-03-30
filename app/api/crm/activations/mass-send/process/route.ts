/**
 * POST /api/crm/activations/mass-send/process
 * Processa um lote de grupos (budget ~45s). Streaming + heartbeat evita 504 no Netlify.
 * Com trabalho restante, encadeia outra POST (imediato + backup via after() registrado no handler).
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
  /** Atualizado ao fim do processamento; `after()` corre após o stream fechar (chainState já está definido). */
  const chainState = { morePending: false };
  let afterRegistered = false;
  try {
    after(() => {
      if (chainState.morePending) {
        setTimeout(() => triggerMassSendProcessFromOrigin(publicOrigin), CHAIN_FOLLOWUP_MS);
      }
    });
    afterRegistered = true;
  } catch {
    /* contexto sem after() — backup agendado no fechamento do stream */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' '));
        } catch {
          /* stream fechado */
        }
      }, HEARTBEAT_MS);

      try {
        const payload = await executeMassSendProcess(publicOrigin);
        const data =
          payload.success && payload.data && typeof payload.data === 'object'
            ? (payload.data as Record<string, unknown>)
            : null;
        if (data?.more_pending === true && publicOrigin) {
          chainState.morePending = true;
          triggerMassSendProcessFromOrigin(publicOrigin);
        }
        clearInterval(heartbeat);
        controller.enqueue(encoder.encode(JSON.stringify(payload)));
      } catch (e: unknown) {
        clearInterval(heartbeat);
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MassSend] process route — exceção:', msg);
        const fallback = { success: false, data: { processed: false, message: `Erro interno: ${msg}` } };
        controller.enqueue(encoder.encode(JSON.stringify(fallback)));
      } finally {
        clearInterval(heartbeat);
        controller.close();
        if (chainState.morePending && !afterRegistered) {
          setTimeout(() => triggerMassSendProcessFromOrigin(publicOrigin), CHAIN_FOLLOWUP_MS);
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
