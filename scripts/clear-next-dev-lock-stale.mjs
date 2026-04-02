#!/usr/bin/env node
/**
 * Remove .next/dev/lock apenas se nenhum processo estiver usando o arquivo.
 * Use após crash do Next ou quando o lock ficou órfão. Se outro `next dev`
 * estiver rodando, falha com mensagem clara (não mata processos).
 */
import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const lock = join(process.cwd(), '.next', 'dev', 'lock');

if (!existsSync(lock)) {
  process.exit(0);
}

let holders = '';
try {
  holders = execSync(`lsof -t "${lock}" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
} catch {
  holders = '';
}

if (holders) {
  const pids = holders.split(/\n/).filter(Boolean).join(', ');
  console.error(
    `[next] Outro processo segura o lock do dev server (PIDs: ${pids}). Encerre esse \`npm run dev\` antes de iniciar outro.`
  );
  process.exit(1);
}

try {
  unlinkSync(lock);
  console.log('[next] Lock obsoleto removido (.next/dev/lock).');
} catch (e) {
  console.error('[next] Não foi possível remover o lock:', e?.message || e);
  process.exit(1);
}
