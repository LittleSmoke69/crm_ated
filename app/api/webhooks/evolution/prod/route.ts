import { NextRequest } from 'next/server';
import { resolveZaplotoIdFromWebhookRequest } from '@/lib/server/webhook-zaploto-context';
import { getSharedWebhookQueue } from '@/lib/queue/webhook-queue';

/** Evita payloads enormes (memória + parse) sem tocar o banco. */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * POST /api/webhooks/evolution/prod
 *
 * Retorna 200 em < 5ms: apenas enfileira o payload no Redis (BullMQ).
 * O webhook-queue-worker processa com concorrência controlada (WEBHOOK_WORKER_CONCURRENCY).
 *
 * Isso elimina completamente o problema de after() sem limite de concorrência
 * que causava acúmulo de callbacks e alta CPU no next-server.
 */
export async function POST(req: NextRequest) {
  try {
    const zaplotoId = await resolveZaplotoIdFromWebhookRequest(req);

    let payload: any;
    try {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_WEBHOOK_BODY_BYTES) {
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

    // Enfileira no Redis — operação < 2ms, nunca bloqueia
    const queue = getSharedWebhookQueue();
    await queue.add('process-event', { payload, zaplotoId }, {
      // jobId baseado em messageId para deduplicação natural na fila
      jobId: payload?.data?.key?.id
        ? `${payload?.instance ?? payload?.instanceName ?? 'unknown'}:${payload.data.key.id}`
        : undefined,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ [WEBHOOK PROD] Erro ao enfileirar:', err);
    // Retorna 200 mesmo assim para evitar retries desnecessários da Evolution API
    return new Response(JSON.stringify({ ok: true }), {
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
      mode: 'queue',
      now: new Date().toISOString(),
      message: 'Webhook Evolution PROD (modo fila) está ativo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
