/**
 * RabbitMQ — publisher e setup de filas para webhooks Evolution.
 *
 * Push-based: broker empurra mensagens para consumers, backpressure via prefetch.
 * Resultado: zero CPU de polling, DLQ automático após MAX_RETRIES.
 *
 * Resilience:
 * - Reconexão automática com backoff exponencial
 * - Timeout no publish (não trava a request HTTP)
 * - Bloqueia uma única request por vez no path de reconnect
 */
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';

export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672';

export const EXCHANGE = 'webhook.evolution';
export const QUEUE = 'webhook.evolution.jobs';
export const DLX = 'webhook.evolution.dlx';
export const DLQ = 'webhook.evolution.dlq';
export const ROUTING_KEY = 'event';

const PUBLISH_TIMEOUT_MS = Number(process.env.RABBITMQ_PUBLISH_TIMEOUT_MS ?? 5000);
const CONNECT_TIMEOUT_MS = Number(process.env.RABBITMQ_CONNECT_TIMEOUT_MS ?? 8000);

let _connection: ChannelModel | null = null;
let _channel: ConfirmChannel | null = null;
let _connecting: Promise<ConfirmChannel> | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[rabbitmq] timeout ${label} após ${ms}ms`)), ms),
    ),
  ]);
}

async function establish(): Promise<ConfirmChannel> {
  const conn = await withTimeout(amqp.connect(RABBITMQ_URL), CONNECT_TIMEOUT_MS, 'connect');
  _connection = conn;

  conn.on('close', () => {
    console.warn('[rabbitmq] Conexão fechada — reconectará na próxima publicação');
    _connection = null;
    _channel = null;
  });
  conn.on('error', (err: Error) => {
    console.error('[rabbitmq] Erro na conexão:', err.message);
    _connection = null;
    _channel = null;
  });

  const ch = await conn.createConfirmChannel();
  _channel = ch;

  ch.on('close', () => {
    console.warn('[rabbitmq] Canal fechado');
    _channel = null;
  });
  ch.on('error', (err: Error) => {
    console.error('[rabbitmq] Erro no canal:', err.message);
    _channel = null;
  });

  // Dead Letter Exchange + Queue (mensagens que esgotam retries vão para DLQ)
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, ROUTING_KEY);

  // Fila principal com DLQ configurada
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

  console.log('[rabbitmq] Conexão estabelecida e filas configuradas');
  return ch;
}

export async function getRabbitChannel(): Promise<ConfirmChannel> {
  if (_channel) return _channel;
  if (_connecting) return _connecting;

  _connecting = establish().finally(() => {
    _connecting = null;
  });
  return _connecting;
}

export async function closeRabbit(): Promise<void> {
  try {
    if (_channel) await _channel.close();
  } catch (err) {
    console.warn('[rabbitmq] erro ao fechar canal:', (err as Error)?.message);
  }
  try {
    if (_connection) await _connection.close();
  } catch (err) {
    console.warn('[rabbitmq] erro ao fechar conexão:', (err as Error)?.message);
  }
  _channel = null;
  _connection = null;
}

/**
 * Publica um evento de webhook na fila RabbitMQ.
 * Usa ConfirmChannel para garantir entrega ao broker. Falha rápido em PUBLISH_TIMEOUT_MS.
 */
export async function publishWebhookEvent(
  payload: unknown,
  zaplotoId: string | null,
): Promise<void> {
  const ch = await getRabbitChannel();
  const p = payload as any;
  const messageId = p?.data?.key?.id
    ? `${(p?.instance ?? p?.instanceName ?? 'unknown').replace(/:/g, '_')}__${p.data.key.id.replace(/:/g, '_')}`
    : undefined;

  const publish = new Promise<void>((resolve, reject) => {
    const ok = ch.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify({ payload, zaplotoId })),
      {
        persistent: true,
        contentType: 'application/json',
        messageId,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );

    if (!ok) {
      ch.once('drain', () => ch.waitForConfirms().then(resolve).catch(reject));
    } else {
      ch.waitForConfirms().then(resolve).catch(reject);
    }
  });

  await withTimeout(publish, PUBLISH_TIMEOUT_MS, 'publish');
}
