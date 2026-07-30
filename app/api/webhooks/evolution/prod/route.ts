import { NextRequest, after } from 'next/server';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { resolveZaplotoIdFromWebhookRequest } from '@/lib/server/webhook-zaploto-context';
import { isRabbitMqConfigured, publishWebhookEvent } from '@/lib/queue/rabbitmq';
import { processWebhookEvent } from '@/lib/services/webhook-processor';

/** Evita payloads enormes (memória + parse) sem tocar o banco. */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

export const runtime = 'nodejs';
/** Sync (sem RabbitMQ) precisa de margem; com fila o work é nos workers. */
export const maxDuration = 60;

function scheduleSyncProcess(payload: unknown, zaplotoId: string | null): void {
  after(() =>
    processWebhookEvent(payload, { zaplotoId }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WEBHOOK PROD] Falha no processamento sync:', msg);
    }),
  );
}

/**
 * POST /api/webhooks/evolution/prod
 *
 * - Com `RABBITMQ_URL`: enfileira no RabbitMQ (workers processam).
 * - Sem RabbitMQ (stack leve): agenda `processWebhookEvent` via `after()` —
 *   grava `evolution_webhook_events` + chat, igual ao fluxo validado em /test.
 * - Se o publish na fila falhar: fallback sync para não perder o evento.
 */
export async function POST(req: NextRequest) {
  // Sem token de env: proteção via rate limit por IP (e tamanho máximo do body).
  const rateLimited = checkIpRateLimit(req, 'webhook-evolution-prod', 300, 60 * 1000);
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

    let payload: unknown;
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

    if (isRabbitMqConfigured()) {
      try {
        await publishWebhookEvent(payload, zaplotoId);
        return new Response(JSON.stringify({ ok: true, mode: 'rabbitmq' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[WEBHOOK PROD] Erro ao enfileirar — fallback sync:', {
          message,
          zaplotoId,
          payloadSize,
        });
        scheduleSyncProcess(payload, zaplotoId);
        return new Response(JSON.stringify({ ok: true, mode: 'sync_fallback' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    scheduleSyncProcess(payload, zaplotoId);
    return new Response(JSON.stringify({ ok: true, mode: 'sync' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[WEBHOOK PROD] Erro inesperado:', {
      message,
      zaplotoId,
      payloadSize,
    });
    // 200 evita retry-storm da Evolution
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
  const mode = isRabbitMqConfigured() ? 'rabbitmq' : 'sync';
  return new Response(
    JSON.stringify({
      ok: true,
      env: 'prod',
      mode,
      now: new Date().toISOString(),
      message:
        mode === 'rabbitmq'
          ? 'Webhook Evolution PROD (modo fila) está ativo'
          : 'Webhook Evolution PROD (modo sync, sem RabbitMQ) está ativo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
