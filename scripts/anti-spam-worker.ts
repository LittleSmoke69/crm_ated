/**
 * Script para rodar o Worker Anti-Spam em tempo real.
 * Uso: npx tsx scripts/anti-spam-worker.ts
 * Em produção, é iniciado pelo container zaplotov3-antispam-worker
 * (ANTISPAM_WORKER_ONLY=true no entrypoint.sh).
 *
 * Variáveis de ambiente:
 * - ANTI_SPAM_POLL_MS:    intervalo de polling em ms (default 800)
 * - ANTI_SPAM_BATCH_SIZE: eventos por lote (default 50)
 * - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: obrigatórias
 */

import 'dotenv/config';
import { startAntiSpamWorker } from '../lib/anti-spam/antiSpamWorker';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[anti-spam-worker] ENV ausente: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
  process.exit(1);
}

console.log(
  `[anti-spam-worker] Iniciando worker (poll=${process.env.ANTI_SPAM_POLL_MS || 800}ms, batch=${process.env.ANTI_SPAM_BATCH_SIZE || 50})...`,
);

let stop: (() => void) | null = null;
try {
  stop = startAntiSpamWorker();
} catch (err) {
  console.error('[anti-spam-worker] Falha ao iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
}

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[anti-spam-worker] ${signal} recebido — encerrando...`);
  try {
    stop?.();
  } catch (err) {
    console.warn('[anti-spam-worker] erro durante stop:', err instanceof Error ? err.message : err);
  }
  // Margem para o worker drenar callbacks em vôo antes de matar processo
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[anti-spam-worker] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[anti-spam-worker] unhandledRejection:', reason);
});
