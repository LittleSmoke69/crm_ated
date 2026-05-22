/**
 * Worker RabbitMQ para webhooks Evolution.
 *
 * Push-based: broker empurra mensagens (prefetch controla backpressure).
 * Zero polling — CPU próximo de 0% quando não há eventos.
 *
 * Resilience:
 * - Reconexão automática com backoff se conexão cai
 * - Graceful shutdown aguarda jobs em vôo (até 30s) antes de matar processo
 *
 * Inicia com: npm run rabbitmq:worker
 */
import 'dotenv/config';
import amqp, { type ChannelModel, type Channel } from 'amqplib';
import { RABBITMQ_URL, QUEUE, DLX, DLQ, EXCHANGE, ROUTING_KEY } from '../lib/queue/rabbitmq';

const PREFETCH = Number(process.env.RABBITMQ_WORKER_PREFETCH ?? 10);
const MAX_RETRIES = Number(process.env.RABBITMQ_MAX_RETRIES ?? 3);
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const SHUTDOWN_GRACE_MS = 30_000;

let inFlight = 0;
let shuttingDown = false;

async function loadProcessor() {
  const { processWebhookEvent } = await import('../lib/services/webhook-processor');
  return processWebhookEvent;
}

async function setupChannel(processEvent: Awaited<ReturnType<typeof loadProcessor>>): Promise<{ conn: ChannelModel; ch: Channel }> {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

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
  await ch.prefetch(PREFETCH);

  ch.consume(QUEUE, async (msg) => {
    if (!msg || shuttingDown) return;
    inFlight++;

    const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number;
    let parsed: { payload: any; zaplotoId: string | null };

    try {
      parsed = JSON.parse(msg.content.toString());
    } catch {
      console.error('[rabbitmq-worker] JSON inválido — descartando mensagem');
      ch.nack(msg, false, false);
      inFlight--;
      return;
    }

    try {
      const { payload, zaplotoId } = parsed;
      await processEvent(payload, { zaplotoId });
      ch.ack(msg);
      console.log(`[rabbitmq-worker] OK ${msg.properties.messageId ?? 'job'}`);
    } catch (err: any) {
      console.error(`[rabbitmq-worker] FAIL (tentativa ${retryCount + 1}):`, err?.message);

      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(5000 * 2 ** retryCount, 60_000);
        setTimeout(() => {
          try {
            ch.publish(EXCHANGE, ROUTING_KEY, msg.content, {
              ...msg.properties,
              headers: { ...msg.properties.headers, 'x-retry-count': retryCount + 1 },
            });
            ch.ack(msg);
          } catch (publishErr: any) {
            console.error('[rabbitmq-worker] falha ao republicar retry:', publishErr?.message);
            // Não acka — broker vai re-entregar quando canal cair
          }
        }, delay);
      } else {
        console.error(`[rabbitmq-worker] DLQ ${msg.properties.messageId ?? 'job'} (max retries)`);
        ch.nack(msg, false, false);
      }
    } finally {
      inFlight--;
    }
  });

  console.log(`[rabbitmq-worker] Pronto — aguardando eventos na fila "${QUEUE}"`);
  return { conn, ch };
}

async function runWithReconnect() {
  const processEvent = await loadProcessor();
  let attempt = 0;

  while (!shuttingDown) {
    try {
      console.log(`[rabbitmq-worker] Iniciando prefetch=${PREFETCH} max_retries=${MAX_RETRIES}...`);
      const { conn } = await setupChannel(processEvent);
      attempt = 0;

      await new Promise<void>((resolve, reject) => {
        conn.once('close', () => resolve());
        conn.once('error', (err) => reject(err));
      });

      if (shuttingDown) break;
      console.warn('[rabbitmq-worker] Conexão fechada — reconectando');
    } catch (err: any) {
      console.error('[rabbitmq-worker] Erro de conexão:', err?.message);
    }

    if (shuttingDown) break;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    attempt++;
    console.log(`[rabbitmq-worker] Aguardando ${delay}ms antes de reconectar...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[rabbitmq-worker] ${signal} recebido — drenando ${inFlight} job(s) em vôo (timeout=${SHUTDOWN_GRACE_MS}ms)...`);

  const start = Date.now();
  while (inFlight > 0 && Date.now() - start < SHUTDOWN_GRACE_MS) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (inFlight > 0) {
    console.warn(`[rabbitmq-worker] Saindo com ${inFlight} job(s) ainda em vôo (timeout)`);
  } else {
    console.log('[rabbitmq-worker] Drenagem concluída.');
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

runWithReconnect().catch((err) => {
  console.error('[rabbitmq-worker] Erro fatal:', err);
  process.exit(1);
});
