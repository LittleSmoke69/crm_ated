/**
 * Worker da fila de webhooks Evolution.
 * Processa eventos com concorrência controlada (CONCURRENCY jobs simultâneos).
 * Inicia com: npm run webhook:worker
 */
import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { createRedisConnection, type WebhookJobData } from '../lib/queue/webhook-queue';

const CONCURRENCY = Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? 8);
const QUEUE_NAME = 'webhook-evolution';

// Importa o processador do webhook (mesmo código do after())
// Usa dynamic import para carregar o módulo Next.js corretamente
async function loadProcessor() {
  const { processWebhookEvent } = await import('../lib/services/webhook-processor');
  return processWebhookEvent;
}

async function main() {
  console.log(`[webhook-worker] Iniciando com concorrência=${CONCURRENCY}...`);

  const processEvent = await loadProcessor();
  const connection = createRedisConnection();

  const worker = new Worker<WebhookJobData>(
    QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      const { payload, zaplotoId } = job.data;
      await processEvent(payload, { zaplotoId });
    },
    {
      connection,
      concurrency: CONCURRENCY,
      limiter: {
        max: CONCURRENCY,
        duration: 1000,
      },
    },
  );

  worker.on('completed', (job) => {
    console.log(`[webhook-worker] ✅ Job ${job.id} concluído`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[webhook-worker] ❌ Job ${job?.id} falhou:`, err?.message);
  });

  worker.on('error', (err) => {
    console.error('[webhook-worker] Erro no worker:', err?.message);
  });

  console.log(`[webhook-worker] Pronto — aguardando eventos na fila "${QUEUE_NAME}"`);

  process.on('SIGTERM', async () => {
    console.log('[webhook-worker] SIGTERM recebido, encerrando gracefully...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[webhook-worker] Erro fatal:', err);
  process.exit(1);
});
