/**
 * WhatsApp Cloud API — normalização de MIME para upload no bucket `chat-media`.
 * A Meta envia tipos com parâmetros (ex.: audio/ogg; codecs=opus); o lookup direto falhava
 * e caía em .bin + application/octet-stream → upload rejeitado ou áudio que não toca no browser.
 */

export function mimeBase(raw: string | undefined | null): string {
  if (raw == null || typeof raw !== 'string') return '';
  return raw.split(';')[0].trim().toLowerCase();
}

/** Extensões de arquivo por tipo base (sem parâmetros). */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/3gpp': '.3gp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

/** Content-Types aceitos pelo bucket chat-media (manter alinhado à migration). */
const BUCKET_AUDIO = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/amr',
  'audio/webm',
  'audio/3gpp',
]);

const BUCKET_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const BUCKET_VIDEO = new Set(['video/mp4', 'video/3gpp']);
const BUCKET_DOC = new Set(['application/pdf']);

function extToAudioContentType(ext: string): string {
  const map: Record<string, string> = {
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.amr': 'audio/amr',
    '.webm': 'audio/webm',
    '.3gp': 'audio/3gpp',
  };
  return map[ext] || 'audio/ogg';
}

/**
 * Extensão estável para path no Storage (WhatsApp inbound/outbound).
 */
export function extensionForWhatsAppMedia(
  mimeRaw: string | undefined,
  mediaCategory: 'audio' | 'image' | 'video' | 'document' | 'sticker'
): string {
  const base = mimeBase(mimeRaw);
  if (base && EXT_BY_MIME[base]) return EXT_BY_MIME[base];

  if (mediaCategory === 'sticker') return '.webp';
  if (mediaCategory === 'image') return '.jpg';
  if (mediaCategory === 'video') return '.mp4';
  if (mediaCategory === 'document') return '.pdf';

  // Áudio: heurísticas quando a Meta manda variantes ou mime vazio
  if (!base) return '.ogg';
  if (base.includes('ogg') || base.includes('opus')) return '.ogg';
  if (base.includes('mpeg') || base.endsWith('/mp3')) return '.mp3';
  if (base.includes('mp4') || base.includes('m4a')) return '.m4a';
  if (base.includes('aac')) return '.aac';
  if (base.includes('amr')) return '.amr';
  if (base.includes('webm')) return '.webm';
  if (base.includes('3gpp')) return '.3gp';
  if (base.startsWith('audio/')) return '.ogg';
  return '.bin';
}

/**
 * Content-Type do upload: precisa estar na allowlist do bucket, senão o Storage rejeita.
 */
export function storageContentTypeForWhatsAppMedia(
  mimeRaw: string | undefined,
  ext: string,
  mediaCategory: 'audio' | 'image' | 'video' | 'document' | 'sticker'
): string {
  let base = mimeBase(mimeRaw);
  if (mediaCategory === 'audio' && base === 'audio/opus') {
    base = 'audio/ogg';
  }

  switch (mediaCategory) {
    case 'sticker':
      if (base && BUCKET_IMAGE.has(base)) return base;
      return 'image/webp';
    case 'audio':
      if (base && BUCKET_AUDIO.has(base)) return base;
      return extToAudioContentType(ext);
    case 'image':
      if (base && BUCKET_IMAGE.has(base)) return base;
      if (ext === '.png') return 'image/png';
      if (ext === '.webp') return 'image/webp';
      if (ext === '.gif') return 'image/gif';
      return 'image/jpeg';
    case 'video':
      if (base && BUCKET_VIDEO.has(base)) return base;
      return 'video/mp4';
    case 'document':
      if (base && BUCKET_DOC.has(base)) return base;
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
