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

function buildCronBlock(appDir: string, npmBin: string, logFile: string): string {
  const lines: string[] = [];
  lines.push(BLOCK_START);
  lines.push('# Gerado por scripts/linux/install-linux-cron.ts');
  lines.push('# Mantemos UTC para equivaler ao comportamento do Netlify');
  lines.push('CRON_TZ=UTC');
  lines.push('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
  lines.push('');

  for (const job of SCHEDULED_JOBS) {
    const lockFile = `/tmp/zaploto-cron-${job.name}.lock`;
    const cmd = `${job.cron} cd "${appDir}" && flock -n "${lockFile}" "${npmBin}" run cron:run -- ${job.name} >> "${logFile}" 2>&1`;
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

function main(): void {
  const appDir = process.env.APP_DIR?.trim() || process.cwd();
  const npmBin = process.env.NPM_BIN?.trim() || 'npm';
  const logFile = process.env.CRON_LOG_FILE?.trim() || '/var/log/zaploto-cron.log';
  const dryRun = process.argv.includes('--dry-run');

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
    console.log(`- ${job.name} (${job.cron})`);
  }
}

main();
