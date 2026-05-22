import { spawnSync } from 'child_process';
import { SCHEDULED_JOBS } from './scheduled-jobs';

const BLOCK_START = '# >>> ZAPLOTO_V3_CRON >>>';
const BLOCK_END = '# <<< ZAPLOTO_V3_CRON <<<';

function runShell(command: string, args: string[], input?: string): { ok: boolean; stdout: string; stderr: string; code: number } {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status ?? 1,
  };
}

function readCurrentCrontab(): string {
  const result = runShell('crontab', ['-l']);
  if (result.ok) return result.stdout.trimEnd();

  const stderr = (result.stderr || '').toLowerCase();
  if (stderr.includes('no crontab') || result.code === 1) {
    return '';
  }

  throw new Error(`Falha ao ler crontab: ${result.stderr || `exit ${result.code}`}`);
}

/**
 * Infere um timeout default a partir do cron schedule:
 *  - "*​/N * * * *" → (N*60) - 10s  (deixa margem antes do próximo tick)
 *  - "M H * * *" (uma vez ao dia) → 600s
 *  - default → 110s
 * Permite override via `timeout_s` em scheduled-jobs.ts.
 */
function defaultTimeoutForCron(expr: string): number {
  const match = expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (match) {
    const minutes = parseInt(match[1], 10);
    if (Number.isFinite(minutes) && minutes > 0) {
      return Math.max(60, minutes * 60 - 10);
    }
  }
  // "M H * * *" — uma vez ao dia: timeout generoso.
  if (/^\d+\s+\d+\s+\*\s+\*\s+\*$/.test(expr)) return 600;
  return 110;
}

function buildCronBlock(appDir: string, _npmBin: string, logFile: string): string {
  const wrapper = `${appDir}/scripts/linux/cron-wrapper.sh`;
  const lines: string[] = [];
  lines.push(BLOCK_START);
  lines.push('# Gerado por scripts/linux/install-linux-cron.ts');
  lines.push('# CRON_TZ=UTC: horários previsíveis em qualquer fuso da VPS');
  lines.push('CRON_TZ=UTC');
  lines.push('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
  lines.push('');

  for (const job of SCHEDULED_JOBS) {
    const timeoutS = job.timeout_s ?? defaultTimeoutForCron(job.cron);
    // wrapper cuida de: lock exclusivo, timeout duro, log estruturado.
    const cmd = `${job.cron} ${wrapper} ${job.name} ${timeoutS} >> "${logFile}" 2>&1`;
    lines.push(cmd);
  }

  lines.push(BLOCK_END);
  return lines.join('\n');
}

function upsertBlock(currentCrontab: string, newBlock: string): string {
  if (!currentCrontab.trim()) return `${newBlock}\n`;

  const hasBlock = currentCrontab.includes(BLOCK_START) && currentCrontab.includes(BLOCK_END);
  if (!hasBlock) {
    return `${currentCrontab}\n\n${newBlock}\n`;
  }

  const start = currentCrontab.indexOf(BLOCK_START);
  const end = currentCrontab.indexOf(BLOCK_END);
  const endWithMarker = end + BLOCK_END.length;

  const before = currentCrontab.slice(0, start).trimEnd();
  const after = currentCrontab.slice(endWithMarker).trimStart();

  const sections = [before, newBlock, after].filter(Boolean);
  return `${sections.join('\n\n')}\n`;
}

// Variáveis exigidas pelos crons que delegam para a API Next.js via HTTP.
// Sem elas, esses crons retornam {ok:false} silenciosamente (já causou incidente).
const HTTP_BOUND_CRONS: Array<{ name: string; requires: string[] }> = [
  { name: 'flow-question-timeouts',      requires: ['SITE_URL', 'CRON_SECRET'] },
  { name: 'maturation-tick',             requires: ['SITE_URL', 'CRON_SECRET'] },
  { name: 'process-activation-mass-send',requires: ['URL', 'CRON_SECRET'] },
  { name: 'process-group-fetch-jobs',    requires: ['SITE_URL', 'GROUP_FETCH_JOB_SECRET'] },
  { name: 'transfer-resolve-expired',    requires: ['URL', 'TRANSFER_RESOLVE_CRON_SECRET'] },
];

function warnMissingEnvForCrons(): void {
  // Aceita SITE_URL como fallback para URL (e vice-versa).
  const isSet = (k: string): boolean => {
    const v = process.env[k]?.trim();
    if (v) return true;
    if (k === 'URL') return !!process.env.SITE_URL?.trim();
    if (k === 'SITE_URL') return !!process.env.URL?.trim();
    return false;
  };
  const warnings: string[] = [];
  for (const job of HTTP_BOUND_CRONS) {
    const missing = job.requires.filter((k) => !isSet(k));
    if (missing.length > 0) {
      warnings.push(`  - ${job.name}: faltando ${missing.join(', ')}`);
    }
  }
  if (warnings.length > 0) {
    console.warn('');
    console.warn('⚠️  AVISO: alguns crons HTTP-bound NÃO terão efeito sem essas env vars:');
    warnings.forEach((w) => console.warn(w));
    console.warn('   (esses crons retornarão {ok:false} silenciosamente — verifique .env)');
    console.warn('');
  }
}

function main(): void {
  const appDir = process.env.APP_DIR?.trim() || process.cwd();
  const npmBin = process.env.NPM_BIN?.trim() || 'npm';
  const logFile = process.env.CRON_LOG_FILE?.trim() || '/var/log/zaploto-cron.log';
  const dryRun = process.argv.includes('--dry-run');

  warnMissingEnvForCrons();

  const current = readCurrentCrontab();
  const block = buildCronBlock(appDir, npmBin, logFile);
  const merged = upsertBlock(current, block);

  if (dryRun) {
    console.log(merged);
    return;
  }

  const writeResult = runShell('crontab', ['-'], merged);
  if (!writeResult.ok) {
    throw new Error(`Falha ao gravar crontab: ${writeResult.stderr || `exit ${writeResult.code}`}`);
  }

  console.log('Crontab atualizado com sucesso.');
  console.log(`- APP_DIR: ${appDir}`);
  console.log(`- NPM_BIN: ${npmBin}`);
  console.log(`- CRON_LOG_FILE: ${logFile}`);
  console.log('');
  console.log('Jobs instalados:');
  for (const job of SCHEDULED_JOBS) {
    const t = job.timeout_s ?? defaultTimeoutForCron(job.cron);
    console.log(`- ${job.name} (${job.cron}, timeout=${t}s)`);
  }
}

main();
