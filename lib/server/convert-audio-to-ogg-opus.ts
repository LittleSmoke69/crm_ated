import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import { resolveFfmpegPath } from '@/lib/server/resolve-ffmpeg-path';

const execFileAsync = promisify(execFile);
const FFMPEG_OPTS = { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 } as const;

/**
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages/
 * Nota de voz: .ogg + codec OPUS + mono + `voice: true` no envio.
 */
/**
 * Campo `type` no upload Media API — Meta exige OGG com codec OPUS explícito.
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media/
 */
export const WHATSAPP_AUDIO_META_UPLOAD_TYPE = 'audio/ogg; codecs=opus';

/** Limite da tabela de formatos suportados (OGG/AAC/MP3/…). */
export const WHATSAPP_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

/** Acima disso a Meta ainda entrega, mas mostra ícone de download em vez de play na nota de voz. */
export const WHATSAPP_VOICE_PLAY_ICON_MAX_BYTES = 512 * 1024;

/** MIME já aceito pela Meta sem conversão (upload direto). */
export function isWhatsAppReadyAudioMime(mime: string): boolean {
  const base = mime.split(';')[0].trim().toLowerCase();
  return base === 'audio/ogg' || base === 'audio/opus' || base === 'audio/mpeg' || base === 'audio/mp3';
}

/**
 * Converte arquivo de áudio para OGG/OPUS (voz WhatsApp).
 * @throws se FFmpeg não estiver disponível ou conversão falhar
 */
export async function convertAudioFileToOggOpus(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error(
      'FFmpeg não encontrado. Instale com "brew install ffmpeg" (macOS) ou defina FFMPEG_PATH no .env apontando para o binário.'
    );
  }

  // Gravações do browser (Safari/Chrome) costumam ser Opus dentro de MP4/M4A.
  // Conversão direta m4a→ogg gera OGG que a Meta rejeita (#131053 octet-stream).
  // Dois passos (PCM WAV → OGG/OPUS mono 16 kHz) é o formato aceito na entrega.
  const pcmWavPath = outputPath.replace(/\.ogg$/i, '') + '.pcm.wav';

  try {
    await execFileAsync(
      ffmpegPath,
      ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', pcmWavPath],
      FFMPEG_OPTS
    );

    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i',
        pcmWavPath,
        '-c:a',
        'libopus',
        '-application',
        'voip',
        '-b:a',
        '32k',
        '-f',
        'ogg',
        outputPath,
      ],
      FFMPEG_OPTS
    );
  } finally {
    await unlink(pcmWavPath).catch(() => {});
  }
}

const OGG_MAGIC = Buffer.from('OggS');

/** Cabeçalho OGG válido (exigido pela Meta; evita detecção como application/octet-stream). */
export function isValidWhatsAppOggOpusBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(OGG_MAGIC);
}
