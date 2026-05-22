import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ffmpegStaticPath from 'ffmpeg-static';

const FFMPEG_BIN = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

let cached: string | null | undefined;

function isUsableFfmpegPath(p: string | null | undefined): p is string {
  if (!p || typeof p !== 'string') return false;
  const trimmed = p.trim();
  if (!trimmed || trimmed.startsWith('/ROOT/')) return false;
  return existsSync(trimmed);
}

/** Caminho do binário empacotado em node_modules/ffmpeg-static (dependência do projeto). */
function ffmpegStaticFromNodeModules(): string | null {
  const candidates: string[] = [];

  const cwd = process.cwd();
  candidates.push(join(cwd, 'node_modules', 'ffmpeg-static', FFMPEG_BIN));

  // Monorepo / cwd na raiz acima do app Next
  const nested = join(cwd, 'ZaplotoV3', 'node_modules', 'ffmpeg-static', FFMPEG_BIN);
  candidates.push(nested);

  if (typeof ffmpegStaticPath === 'string') {
    candidates.push(ffmpegStaticPath);
  }

  try {
    const req = createRequire(join(cwd, 'package.json'));
    const pkgJson = req.resolve('ffmpeg-static/package.json');
    candidates.push(join(dirname(pkgJson), FFMPEG_BIN));
  } catch {
    /* ignore */
  }

  for (const p of candidates) {
    if (isUsableFfmpegPath(p)) return p;
  }
  return null;
}

function resolveUncached(): string | null {
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (isUsableFfmpegPath(envPath)) return envPath;

  // Dependência npm — prioridade no Next (não depende de PATH do SO)
  const fromPackage = ffmpegStaticFromNodeModules();
  if (fromPackage) return fromPackage;

  try {
    const which = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (isUsableFfmpegPath(which)) return which;
  } catch {
    /* ignore */
  }

  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (isUsableFfmpegPath(p)) return p;
  }

  return null;
}

/**
 * FFmpeg incluso via dependência `ffmpeg-static` + fallbacks (FFMPEG_PATH / sistema).
 */
export function resolveFfmpegPath(): string | null {
  if (cached !== undefined) return cached;
  cached = resolveUncached();
  return cached;
}

/** Invalida cache (testes). */
export function resetFfmpegPathCache(): void {
  cached = undefined;
}
