/**
 * Script para reset diário de contadores
 * 
 * Este script deve ser executado via cron diariamente às 00:00 (fuso Recife/Brasil)
 * 
 * Exemplo de crontab:
 * 0 0 * * * cd /caminho/do/projeto/zaplotoapp && node -r ts-node/register scripts/reset-daily-counters.ts
 * 
 * Ou usando Vercel Cron (se deploy na Vercel):
 * Adicione no vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/admin/evolution/reset-daily",
 *     "schedule": "0 0 * * *"
 *   }]
 * }
 * 
 * Ou usando Supabase Cron (se usar Supabase):
 * SELECT cron.schedule(
 *   'reset-daily-counters',
 *   '0 0 * * *',
 *   $$
 *   SELECT net.http_post(
 *     url:='https://seu-dominio.com/api/admin/evolution/reset-daily',
 *     headers:='{"Content-Type": "application/json", "Authorization": "Bearer SEU_TOKEN_ADMIN"}'::jsonb
 *   ) AS request_id;
 *   $$
 * );
 */

import { dailyResetService } from '../lib/services/daily-reset-service';

async function main() {
  console.log('🔄 Iniciando reset diário de contadores...');
  console.log(`⏰ Horário atual: ${new Date().toISOString()}`);
  console.log(`⏰ Próximo reset: ${dailyResetService.getNextResetTime().toISOString()}`);

  const result = await dailyResetService.resetDailyCounters();

  if (result.success) {
    console.log(`✅ Reset concluído com sucesso!`);
    console.log(`📊 ${result.resetCount} instâncias resetadas.`);
    process.exit(0);
  } else {
    console.error(`❌ Erro ao resetar contadores: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});

