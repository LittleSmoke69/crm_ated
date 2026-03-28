/**
 * POST /api/crm/activations/mass-send/process
 * Processa EXATAMENTE 1 grupo de uma campanha de disparo em massa.
 * Sempre retorna 200 com JSON — erros vão no body, nunca 500.
 * A re-invocação é feita pela Netlify Scheduled Function.
 */
import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils/response';
import { executeMassSendProcess } from '@/lib/crm/mass-send-process-core';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-cron-secret');
  if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return errorResponse('Não autorizado', 401);
  }

  let payload: unknown;
  try {
    const publicOrigin = req.nextUrl?.origin || new URL(req.url).origin;
    payload = await executeMassSendProcess(publicOrigin);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MassSend] process route — exceção não tratada:', msg);
    payload = { success: false, data: { processed: false, message: `Erro interno: ${msg}` } };
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
