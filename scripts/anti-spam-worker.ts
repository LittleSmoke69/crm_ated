/**
 * Script para rodar o Worker Anti-Spam em tempo real.
 * Uso: npx tsx scripts/anti-spam-worker.ts
 * Ou em PROD: pm2 start "npx tsx scripts/anti-spam-worker.ts" --name anti-spam-worker
 *
 * Variáveis de ambiente (opcional):
 * - ANTI_SPAM_POLL_MS: intervalo de polling em ms (default 800)
 * - ANTI_SPAM_BATCH_SIZE: eventos por lote (default 50)
 * - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: obrigatórias para Supabase
 */

import 'dotenv/config';
import { startAntiSpamWorker } from '../lib/anti-spam/antiSpamWorker';

console.log('[AntiSpam] Iniciando worker...');
const stop = startAntiSpamWorker();

process.on('SIGINT', () => {
  console.log('[AntiSpam] Encerrando...');
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[AntiSpam] Encerrando...');
  stop();
  process.exit(0);
});
