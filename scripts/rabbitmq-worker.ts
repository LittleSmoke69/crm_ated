/**
 * Worker RabbitMQ para webhooks Evolution.
 *
 * Push-based: broker empurra mensagens (prefetch controla backpressure).
 * Zero polling — CPU próximo de 0% quando não há eventos.
 *
 * Inicia com: npm run rabbitmq:worker
 */
import 'dotenv/config';
import amqp from 'amqplib';
import { RABBITMQ_URL, QUEUE, DLX, DLQ, EXCHANGE, ROUTING_KEY } from '../lib/queue/rabbitmq';

const PREFETCH = Number(process.env.RABBITMQ_WORKER_PREFETCH ?? 10);
const MAX_RETRIES = Number(process.env.RABBITMQ_MAX_RETRIES ?? 3);

async function loadProcessor() {
  const { processWebhookEvent } = await import('../lib/services/webhook-processor');
  return processWebhookEvent;
}

async function main() {
  console.log(`[rabbitmq-worker] Iniciando prefetch=${PREFETCH} max_retries=${MAX_RETRIES}...`);

  const processEvent = await loadProcessor();
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

  // Garante que filas/exchanges existem (idempotente)
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, ROUTING_KEY);
  await ch.assertExchange(EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': ROUTING_KEY,
      'x-message-ttl': 86_400_000,
    },
  });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  // Prefetch: worker só recebe próxima mensagem após ACK da atual × PREFETCH
  await ch.prefetch(PREFETCH);

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number;
    let parsed: { payload: any; zaplotoId: string | null };

    try {
      parsed = JSON.parse(msg.content.toString());
    } catch {
      console.error('[rabbitmq-worker] JSON inválido — descartando mensagem');
      ch.nack(msg, false, false);
      return;
    }

    try {
      const { payload, zaplotoId } = parsed;
      await processEvent(payload, { zaplotoId });
      ch.ack(msg);
      console.log(`[rabbitmq-worker] ✅ ${msg.properties.messageId ?? 'job'}`);
    } catch (err: any) {
      console.error(`[rabbitmq-worker] ❌ falhou (tentativa ${retryCount + 1}):`, err?.message);

      if (retryCount < MAX_RETRIES) {
        // Re-publica com delay exponencial via headers
        const delay = Math.min(5000 * 2 ** retryCount, 60_000);
        setTimeout(() => {
          ch.publish(EXCHANGE, ROUTING_KEY, msg.content, {
            ...msg.properties,
            headers: { ...msg.properties.headers, 'x-retry-count': retryCount + 1 },
          });
          ch.ack(msg);
        }, delay);
      } else {
        console.error(`[rabbitmq-worker] 💀 Max retries atingido — enviando para DLQ`);
        ch.nack(msg, false, false); // vai para DLQ
      }
    }
  });

  console.log(`[rabbitmq-worker] Pronto — aguardando eventos na fila "${QUEUE}"`);

  const shutdown = async () => {
    console.log('[rabbitmq-worker] Encerrando gracefully...');
    await ch.close();
    await conn.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[rabbitmq-worker] Erro fatal:', err);
  process.exit(1);
});
