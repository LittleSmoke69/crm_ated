import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveFfmpegPath } from '@/lib/server/resolve-ffmpeg-path';

const execFileAsync = promisify(execFile);

export const WHATSAPP_VIDEO_TARGET_BYTES = 14 * 1024 * 1024;
const WHATSAPP_VIDEO_HARD_BYTES = 15 * 1024 * 1024;
const AUDIO_BITRATE_KBPS = 64;
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

function durationFromStderr(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const duration = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function probeDuration(ffmpegPath: string, inputPath: string): Promise<number> {
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr || '');
    const duration = durationFromStderr(stderr);
    if (duration) return duration;
  }
  throw new Error('Não foi possível identificar a duração do vídeo.');
}

async function transcode(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  videoBitrateKbps: number
): Promise<void> {
  // Não vale processar 720p/1080p quando o bitrate calculado para um vídeo
  // longo é muito baixo. A redução adaptativa diminui bastante CPU e tempo de
  // codificação em produção, além de produzir uma imagem melhor nesse bitrate.
  const maxWidth = videoBitrateKbps < 600 ? 640 : videoBitrateKbps < 1200 ? 854 : 1280;
  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        // O scale com force_original_aspect_ratio pode resultar em dimensão ímpar.
        // yuv420p/libx264 exige largura e altura pares; o pad acrescenta no máximo 1 px.
        `scale=${maxWidth}:-2:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
        '-c:v',
        'libx264',
        '-preset',
        // `superfast` é um compromisso melhor para uma rota HTTP: evita que
        // vídeos longos ultrapassem o timeout do proxy em servidores menores.
        'superfast',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'main',
        '-b:v',
        `${videoBitrateKbps}k`,
        '-maxrate',
        `${Math.max(videoBitrateKbps, 160)}k`,
        '-bufsize',
        `${Math.max(videoBitrateKbps * 2, 320)}k`,
        '-c:a',
        'aac',
        '-b:a',
        `${AUDIO_BITRATE_KBPS}k`,
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );
  } catch (error) {
    // O erro completo fica apenas no log do servidor; não deve chegar à interface
    // com comando, caminhos temporários ou detalhes da infraestrutura.
    console.error('[WhatsApp video compression] FFmpeg failed', {
      message: error instanceof Error ? error.message : String(error),
      stderr: String((error as { stderr?: unknown })?.stderr || '').slice(-4000),
    });
    throw new Error('Não foi possível compactar este vídeo. Verifique o formato e tente novamente.');
  }
}

/**
 * Aceita um MP4 grande e devolve H.264/AAC abaixo do limite operacional da Meta.
 * O cálculo usa a duração para definir o bitrate e repete uma vez se o container
 * ultrapassar o limite por overhead.
 */
export async function compressVideoForWhatsApp(input: Buffer): Promise<Buffer> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('FFmpeg não encontrado no servidor; não foi possível compactar o vídeo.');
  }

  const id = randomUUID();
  const inputPath = join(tmpdir(), `wa-video-input-${id}.mp4`);
  const outputPath = join(tmpdir(), `wa-video-output-${id}.mp4`);

  try {
    await writeFile(inputPath, input);
    const durationSeconds = await probeDuration(ffmpegPath, inputPath);
    const targetTotalKbps = Math.floor(
      (WHATSAPP_VIDEO_TARGET_BYTES * 8) / durationSeconds / 1000
    );
    let videoBitrateKbps = Math.min(
      4000,
      Math.floor((targetTotalKbps - AUDIO_BITRATE_KBPS) * 0.92)
    );
    if (videoBitrateKbps < 120) {
      throw new Error(
        'O vídeo é longo demais para ser compactado ao limite do WhatsApp com qualidade utilizável.'
      );
    }

    await transcode(ffmpegPath, inputPath, outputPath, videoBitrateKbps);
    let output = await readFile(outputPath);

    if (output.length > WHATSAPP_VIDEO_HARD_BYTES) {
      const ratio = WHATSAPP_VIDEO_TARGET_BYTES / output.length;
      videoBitrateKbps = Math.max(120, Math.floor(videoBitrateKbps * ratio * 0.9));
      await transcode(ffmpegPath, inputPath, outputPath, videoBitrateKbps);
      output = await readFile(outputPath);
    }

    if (output.length > WHATSAPP_VIDEO_HARD_BYTES) {
      throw new Error('O vídeo compactado ainda excede o limite aceito pelo WhatsApp.');
    }
    return output;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
