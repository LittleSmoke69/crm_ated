/**
 * Worker da fila maturation.steps.
 *
 * Padrão de processamento:
 *   - Prefetch alto (consome rápido da fila) — mas o rate limiter por
 *     instance_name garante que múltiplos steps da MESMA instância sejam
 *     serializados com cooldown.
 *   - Re-busca o step do Supabase pelo `id` antes de processar: o envelope
 *     da fila só carrega identidade; o estado da verdade é o banco.
 *   - Se o step não está mais 'processing' (ex: foi recuperado por
 *     recoverStuckSteps e re-claimado), ignora silenciosamente.
 *
 * Inicia com: npm run maturation:worker
 */
import 'dotenv/config';
import amqp, { type ChannelModel, type Channel } from 'amqplib';
import {
  M_EXCHANGE, M_QUEUE, M_DLX, M_DLQ, M_ROUTING_KEY, RABBITMQ_URL,
  type MaturationTaskEnvelope,
} from '../lib/queue/rabbitmq-maturation';
import { runPerInstance, penalize, pruneStale } from '../lib/services/maturation/instance-rate-limiter';

const PREFETCH = Number(process.env.MATURATION_WORKER_PREFETCH ?? 50);
const MAX_RETRIES = Number(process.env.MATURATION_MAX_RETRIES ?? 2);
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const SHUTDOWN_GRACE_MS = 30_000;

let inFlight = 0;
let shuttingDown = false;

async function loadDeps() {
  const { processStep, updateJobProgress, sendGroupMessage } = await import('../lib/services/maturation/processor');
  const { supabaseServiceRole } = await import('../lib/services/supabase-service');
  return { processStep, updateJobProgress, sendGroupMessage, supabase: supabaseServiceRole };
}

async function setupChannel(deps: Awaited<ReturnType<typeof loadDeps>>): Promise<{ conn: ChannelModel; ch: Channel }> {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

  await ch.assertExchange(M_DLX, 'direct', { durable: true });
  await ch.assertQueue(M_DLQ, { durable: true });
  await ch.bindQueue(M_DLQ, M_DLX, M_ROUTING_KEY);
  await ch.assertExchange(M_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(M_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': M_DLX,
      'x-dead-letter-routing-key': M_ROUTING_KEY,
      'x-message-ttl': 5 * 60_000,
    },
  });
  await ch.bindQueue(M_QUEUE, M_EXCHANGE, M_ROUTING_KEY);
  await ch.prefetch(PREFETCH);

  ch.consume(M_QUEUE, async (msg) => {
    if (!msg || shuttingDown) return;
    inFlight++;

    const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number;
    let env: MaturationTaskEnvelope;

    try {
      env = JSON.parse(msg.content.toString());
    } catch {
      console.error('[maturation-worker] JSON inválido — descartando');
      ch.nack(msg, false, false);
      inFlight--;
      return;
    }

    // Identificador para logs/penalização (ambos os tipos compartilham instance_name)
    const taskLabel = env.type === 'step'
      ? `step=${env.step_id}`
      : `group=${env.master_instance_id}/${env.strophe_idx}`;

    try {
      if (env.type === 'step') {
        // Refresh do step do banco. Status 'processing' é o claim feito pelo
        // claim_maturation_steps no scheduler. Se mudou, alguém já tratou.
        const { data: step, error } = await deps.supabase
          .from('maturation_steps')
          .select('id, job_id, step_index, type, instance_name, target_chat_id, base_url, api_key, payload_json, attempts, status')
          .eq('id', env.step_id)
          .maybeSingle();

        if (error) throw new Error(`fetch step ${env.step_id}: ${error.message}`);
        if (!step || step.status !== 'processing') {
          // Step ausente ou já tratado por outro caminho
          ch.ack(msg);
          return;
        }

        await runPerInstance(env.instance_name, async () => {
          await deps.processStep(deps.supabase, step);
        });

        try {
          await deps.updateJobProgress(deps.supabase, env.job_id);
        } catch (e: any) {
          console.warn(`[maturation-worker] updateJobProgress job=${env.job_id}: ${e?.message}`);
        }
      } else {
        // group-message: payload completo no envelope (sem refresh do banco).
        // Rate-limit por instance_name é COMPARTILHADO com steps — uma instância
        // virgem fazendo warmup + estrofe ao grupo respeita o mesmo cooldown.
        await runPerInstance(env.instance_name, async () => {
          await deps.sendGroupMessage(deps.supabase, {
            master_instance_id: env.master_instance_id,
            instance_name: env.instance_name,
            base_url: env.base_url,
            api_key: env.api_key,
            group_jid: env.group_jid,
            text: env.text,
            next_strophe_idx: env.next_strophe_idx,
          });
        });
      }

      ch.ack(msg);
    } catch (err: any) {
      const msgStr = String(err?.message ?? err);
      // Heurística para 429/rate limit — penaliza a instância
      if (/429|rate.?limit|too many/i.test(msgStr)) {
        await penalize(env.instance_name, 30_000);
        console.warn(`[maturation-worker] rate-limit em ${env.instance_name}, penalizando 30s`);
      }

      console.error(`[maturation-worker] ${taskLabel} retry=${retryCount + 1} erro: ${msgStr}`);

      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(5000 * 2 ** retryCount, 60_000);
        setTimeout(() => {
          try {
            ch.publish(M_EXCHANGE, M_ROUTING_KEY, msg.content, {
              ...msg.properties,
              headers: { ...msg.properties.headers, 'x-retry-count': retryCount + 1 },
            });
            ch.ack(msg);
          } catch (pubErr: any) {
            console.error('[maturation-worker] falha republish retry:', pubErr?.message);
          }
        }, delay);
      } else {
        console.error(`[maturation-worker] DLQ ${taskLabel} (max retries)`);
        ch.nack(msg, false, false);
      }
    } finally {
      inFlight--;
    }
  });

  console.log(`[maturation-worker] Pronto (prefetch=${PREFETCH}, max_retries=${MAX_RETRIES})`);
  return { conn, ch };
}

async function runWithReconnect() {
  const deps = await loadDeps();
  let attempt = 0;

  // Limpeza periódica do rate-limiter
  const pruneTimer = setInterval(() => {
    const removed = pruneStale();
    if (removed > 0) console.log(`[maturation-worker] rate-limiter: ${removed} instância(s) inativas removidas`);
  }, 5 * 60_000);

  while (!shuttingDown) {
    try {
      console.log(`[maturation-worker] Conectando RabbitMQ...`);
      const { conn } = await setupChannel(deps);
      attempt = 0;

      await new Promise<void>((resolve, reject) => {
        conn.once('close', () => resolve());
        conn.once('error', (err) => reject(err));
      });

      if (shuttingDown) break;
      console.warn('[maturation-worker] Conexão fechada — reconectando');
    } catch (err: any) {
      console.error('[maturation-worker] Erro de conexão:', err?.message);
    }

    if (shuttingDown) break;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    attempt++;
    console.log(`[maturation-worker] Reconectando em ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
  }

  clearInterval(pruneTimer);
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[maturation-worker] ${signal} — drenando ${inFlight} step(s) em vôo (timeout=${SHUTDOWN_GRACE_MS}ms)...`);

  const start = Date.now();
  while (inFlight > 0 && Date.now() - start < SHUTDOWN_GRACE_MS) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (inFlight > 0) {
    console.warn(`[maturation-worker] Saindo com ${inFlight} step(s) em vôo (timeout)`);
  } else {
    console.log('[maturation-worker] Drenagem concluída');
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[maturation-worker] uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('[maturation-worker] unhandledRejection:', reason));

runWithReconnect().catch((err) => {
  console.error('[maturation-worker] Erro fatal:', err);
  process.exit(1);
});
