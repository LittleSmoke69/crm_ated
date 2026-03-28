/**
 * POST /api/crm/activations/mass-send/process
 * Processa UM lote de uma campanha de disparo em massa (até ~50s).
 * A re-invocação é feita pelo Netlify Scheduled Function (process-activation-mass-send)
 * que já possui seu próprio while-loop com polling.
 */
import { NextRequest } from 'next/server';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { executeMassSendProcess } from '@/lib/crm/mass-send-process-core';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-internal-cron-secret');
    if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
      return errorResponse('Não autorizado', 401);
    }

    const publicOrigin = req.nextUrl?.origin || new URL(req.url).origin;
    const payload = await executeMassSendProcess(publicOrigin);

    return new Response(JSON.stringify(payload), {
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
