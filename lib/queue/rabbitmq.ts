/**
 * RabbitMQ — publisher e setup de filas para webhooks Evolution.
 *
 * Troca o modelo de polling do BullMQ por push-based (broker empurra para consumers).
 * Resultado: zero CPU de polling, backpressure via prefetch, DLQ automático.
 */
import amqp, { type Connection, type ConfirmChannel } from 'amqplib';

export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672';

export const EXCHANGE = 'webhook.evolution';
export const QUEUE = 'webhook.evolution.jobs';
export const DLX = 'webhook.evolution.dlx';
export const DLQ = 'webhook.evolution.dlq';
export const ROUTING_KEY = 'event';

let _connection: Connection | null = null;
let _channel: ConfirmChannel | null = null;
let _connecting = false;

async function waitReady(ms = 5000): Promise<void> {
  const start = Date.now();
  while (_connecting) {
    if (Date.now() - start > ms) throw new Error('RabbitMQ: timeout aguardando conexão');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function getRabbitChannel(): Promise<ConfirmChannel> {
  if (_channel) return _channel;
  await waitReady();
  if (_channel) return _channel;

  _connecting = true;
  try {
    _connection = await amqp.connect(RABBITMQ_URL);

    _connection.on('close', () => {
      console.warn('[rabbitmq] Conexão fechada — reconectando na próxima chamada');
      _connection = null;
      _channel = null;
    });
    _connection.on('error', (err: Error) => {
      console.error('[rabbitmq] Erro na conexão:', err.message);
      _connection = null;
      _channel = null;
    });

    _channel = await _connection.createConfirmChannel();

    // Dead Letter Exchange + Queue
    await _channel.assertExchange(DLX, 'direct', { durable: true });
    await _channel.assertQueue(DLQ, { durable: true });
    await _channel.bindQueue(DLQ, DLX, ROUTING_KEY);

    // Fila principal com DLQ configurada
    await _channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    await _channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX,
        'x-dead-letter-routing-key': ROUTING_KEY,
        'x-message-ttl': 86_400_000, // 24h
      },
    });
    await _channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

    console.log('[rabbitmq] Conexão estabelecida e filas configuradas');
    return _channel;
  } finally {
    _connecting = false;
  }
}

/**
 * Publica um evento de webhook na fila RabbitMQ.
 * Usa ConfirmChannel para garantir entrega ao broker.
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

  await new Promise<void>((resolve, reject) => {
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
}
