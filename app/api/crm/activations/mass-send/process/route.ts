/**
 * POST /api/crm/activations/mass-send/process
 * Processa EXATAMENTE 1 grupo de uma campanha de disparo em massa.
 * Usa streaming com heartbeat para evitar 504 Inactivity Timeout do gateway Netlify.
 * A re-invocação é feita pela Netlify Scheduled Function.
 */
import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils/response';
import { executeMassSendProcess } from '@/lib/crm/mass-send-process-core';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 5_000;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-cron-secret');
  if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return errorResponse('Não autorizado', 401);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(' ')); } catch { /* stream fechado */ }
      }, HEARTBEAT_MS);

      try {
        const publicOrigin = req.nextUrl?.origin || new URL(req.url).origin;
        const payload = await executeMassSendProcess(publicOrigin);
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
