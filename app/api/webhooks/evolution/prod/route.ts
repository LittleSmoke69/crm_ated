import { NextRequest } from 'next/server';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { assertEvolutionWebhookAuthorized } from '@/lib/server/evolution-webhook-auth';
import { resolveZaplotoIdFromWebhookRequest } from '@/lib/server/webhook-zaploto-context';
import { publishWebhookEvent } from '@/lib/queue/rabbitmq';

/** Evita payloads enormes (memória + parse) sem tocar o banco. */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * POST /api/webhooks/evolution/prod
 *
 * Retorna 200 em < 5ms: apenas enfileira o payload no RabbitMQ.
 * Workers RabbitMQ (zaplotov3-worker1..3) consomem com prefetch controlado e
 * chamam processWebhookEvent. Falha de publish degrada para fallback: a request
 * ainda retorna 200 (evita retry-storm da Evolution) mas loga o evento para audit.
 */
export async function POST(req: NextRequest) {
  const authFail = assertEvolutionWebhookAuthorized(req, 'prod');
  if (authFail) return authFail;
  const rateLimited = checkIpRateLimit(req, 'webhook-evolution-prod', 600, 60 * 1000);
  if (rateLimited) {
    return new Response(JSON.stringify({ ok: false, error: rateLimited }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let zaplotoId: string | null = null;
  let payloadSize = 0;
  try {
    zaplotoId = await resolveZaplotoIdFromWebhookRequest(req);

    let payload: any;
    try {
      const buf = await req.arrayBuffer();
      payloadSize = buf.byteLength;
      if (payloadSize > MAX_WEBHOOK_BODY_BYTES) {
        console.warn(`[WEBHOOK PROD] Payload rejeitado: ${payloadSize} bytes > ${MAX_WEBHOOK_BODY_BYTES}`);
        return new Response(JSON.stringify({ ok: false, error: 'Payload muito grande' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const text = new TextDecoder().decode(buf);
      payload = text ? JSON.parse(text) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    await publishWebhookEvent(payload, zaplotoId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[WEBHOOK PROD] Erro ao enfileirar:', {
      message: err?.message,
      zaplotoId,
      payloadSize,
    });
    // Retorna 200 para evitar retry-storm da Evolution API (mensagem é perdida,
    // mas o log acima permite auditoria; alternativa pior seria explodir os apps).
    return new Response(JSON.stringify({ ok: true, queued: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/webhooks/evolution/prod
 * Healthcheck
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      env: 'prod',
      mode: 'rabbitmq',
      now: new Date().toISOString(),
      message: 'Webhook Evolution PROD (modo fila) está ativo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
