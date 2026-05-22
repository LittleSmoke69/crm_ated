/**
 * RabbitMQ — fila para steps de maturação.
 *
 * Padrão híbrido: o cron-tick faz o "scheduling" (claim_maturation_steps,
 * mesh cycles, virgin maturation, reconcile) e publica cada step claimado
 * nesta fila. Workers consomem e chamam processStep com rate-limit por
 * `instance_name` (evita 429 da Evolution API).
 *
 * Exchange separada do webhook (webhook.evolution) para que cargas distintas
 * tenham filas isoladas — DLQs, métricas e prefetch independentes.
 */
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';

export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672';

export const M_EXCHANGE = 'maturation';
export const M_QUEUE = 'maturation.steps';
export const M_DLX = 'maturation.dlx';
export const M_DLQ = 'maturation.steps.dlq';
export const M_ROUTING_KEY = 'step';

const PUBLISH_TIMEOUT_MS = Number(process.env.RABBITMQ_PUBLISH_TIMEOUT_MS ?? 5000);
const CONNECT_TIMEOUT_MS = Number(process.env.RABBITMQ_CONNECT_TIMEOUT_MS ?? 8000);

let _conn: ChannelModel | null = null;
let _ch: ConfirmChannel | null = null;
let _connecting: Promise<ConfirmChannel> | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[rabbitmq-maturation] timeout ${label} após ${ms}ms`)), ms),
    ),
  ]);
}

async function establish(): Promise<ConfirmChannel> {
  const conn = await withTimeout(amqp.connect(RABBITMQ_URL), CONNECT_TIMEOUT_MS, 'connect');
  _conn = conn;

  conn.on('close', () => {
    console.warn('[rabbitmq-maturation] Conexão fechada');
    _conn = null;
    _ch = null;
  });
  conn.on('error', (err: Error) => {
    console.error('[rabbitmq-maturation] Erro na conexão:', err.message);
    _conn = null;
    _ch = null;
  });

  const ch = await conn.createConfirmChannel();
  _ch = ch;

  ch.on('close', () => { _ch = null; });
  ch.on('error', (err: Error) => {
    console.error('[rabbitmq-maturation] Erro no canal:', err.message);
    _ch = null;
  });

  await ch.assertExchange(M_DLX, 'direct', { durable: true });
  await ch.assertQueue(M_DLQ, { durable: true });
  await ch.bindQueue(M_DLQ, M_DLX, M_ROUTING_KEY);

  await ch.assertExchange(M_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(M_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': M_DLX,
      'x-dead-letter-routing-key': M_ROUTING_KEY,
      // TTL curto: step que ficar 5min sem processamento provavelmente já foi
      // recuperado pelo recoverStuckSteps. Evita acúmulo de eventos obsoletos.
      'x-message-ttl': 5 * 60_000,
    },
  });
  await ch.bindQueue(M_QUEUE, M_EXCHANGE, M_ROUTING_KEY);

  console.log('[rabbitmq-maturation] Conexão e fila configuradas');
  return ch;
}

export async function getMaturationChannel(): Promise<ConfirmChannel> {
  if (_ch) return _ch;
  if (_connecting) return _connecting;
  _connecting = establish().finally(() => { _connecting = null; });
  return _connecting;
}

export async function closeMaturationChannel(): Promise<void> {
  try { if (_ch) await _ch.close(); } catch (err) { console.warn('[rabbitmq-maturation] close ch:', (err as Error)?.message); }
  try { if (_conn) await _conn.close(); } catch (err) { console.warn('[rabbitmq-maturation] close conn:', (err as Error)?.message); }
  _ch = null;
  _conn = null;
}

/**
 * Envelopes da fila — discriminated union por `type`.
 * Worker faz switch e roteia.
 *
 * - 'step'         : worker faz refresh do step pelo id, valida status, processa.
 * - 'group-message': payload completo (worker manda direto à Evolution, sem DB).
 *
 * Ambos os tipos compartilham `instance_name` → mesmo rate-limit por instância.
 */
export type MaturationTaskEnvelope =
  | {
      type: 'step';
      step_id: string;
      job_id: string;
      step_index: number;
      instance_name: string;
    }
  | {
      type: 'group-message';
      master_instance_id: string;
      instance_name: string;
      base_url: string;
      api_key: string;
      group_jid: string;
      text: string;
      strophe_idx: number;
      next_strophe_idx: number;
    };

async function publish(env: MaturationTaskEnvelope, messageId: string): Promise<void> {
  const ch = await getMaturationChannel();
  const publishPromise = new Promise<void>((resolve, reject) => {
    const ok = ch.publish(
      M_EXCHANGE,
      M_ROUTING_KEY,
      Buffer.from(JSON.stringify(env)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId,
        timestamp: Math.floor(Date.now() / 1000),
        headers: {
          'x-task-type': env.type,
          'x-instance-name': env.instance_name,
        },
      },
    );
    if (!ok) {
      ch.once('drain', () => ch.waitForConfirms().then(resolve).catch(reject));
    } else {
      ch.waitForConfirms().then(resolve).catch(reject);
    }
  });
  await withTimeout(publishPromise, PUBLISH_TIMEOUT_MS, 'publish');
}

export async function publishMaturationStep(env: Extract<MaturationTaskEnvelope, { type: 'step' }>): Promise<void>;
export async function publishMaturationStep(env: Omit<Extract<MaturationTaskEnvelope, { type: 'step' }>, 'type'>): Promise<void>;
export async function publishMaturationStep(env: any): Promise<void> {
  const full: MaturationTaskEnvelope = env.type ? env : { type: 'step', ...env };
  await publish(full, `step:${(full as any).step_id}`);
}

export async function publishGroupMessageTask(
  env: Omit<Extract<MaturationTaskEnvelope, { type: 'group-message' }>, 'type'>,
): Promise<void> {
  const full: MaturationTaskEnvelope = { type: 'group-message', ...env };
  // messageId inclui strophe_idx para que retries não colidam com a próxima estrofe
  await publish(full, `group:${env.master_instance_id}:${env.strophe_idx}`);
}
