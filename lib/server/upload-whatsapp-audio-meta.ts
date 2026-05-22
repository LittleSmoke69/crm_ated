import { File } from 'node:buffer';
import {
  WHATSAPP_AUDIO_META_UPLOAD_TYPE,
  isValidWhatsAppOggOpusBuffer,
  isWhatsAppReadyAudioMime,
} from '@/lib/server/convert-audio-to-ogg-opus';

const GRAPH_BASE = 'https://graph.facebook.com';

export type WhatsAppAudioUploadConfig = {
  phone_number_id: string;
  graph_version: string;
  access_token: string;
};

/**
 * Upload de áudio para a Media API da Meta (retorna media_id para envio).
 * Usa `File` com nome `.ogg` e MIME `audio/ogg` (sem `codecs=opus` no header) para a Meta
 * reconhecer o container OGG em vez de application/octet-stream.
 */
export async function uploadAudioBufferToMeta(
  config: WhatsAppAudioUploadConfig,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  if (!isValidWhatsAppOggOpusBuffer(buffer)) {
    throw new Error(
      'Áudio convertido inválido (cabeçalho OGG ausente). Tente gravar novamente ou reinicie o servidor.'
    );
  }

  const uploadType = mimeType.split(';')[0].trim().toLowerCase() || WHATSAPP_AUDIO_META_UPLOAD_TYPE;
  const safeName = fileName.toLowerCase().endsWith('.ogg') ? fileName : 'audio.ogg';

  const version = String(config.graph_version || 'v25.0').replace(/^v/, '');
  const uploadUrl = `${GRAPH_BASE}/v${version}/${config.phone_number_id}/media`;

  const metaFormData = new FormData();
  metaFormData.append('messaging_product', 'whatsapp');
  metaFormData.append('type', uploadType);
  metaFormData.append(
    'file',
    new Blob([buffer], { type: WHATSAPP_AUDIO_META_UPLOAD_TYPE }),
    safeName
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let metaRes: Response;
  try {
    metaRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}` },
      body: metaFormData,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const metaJson = (await metaRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!metaRes.ok || !metaJson.id) {
    throw new Error(metaJson?.error?.message || `Falha no upload para Meta: HTTP ${metaRes.status}`);
  }

  return metaJson.id;
}

export function mimeForMetaUpload(sourceMime: string, converted: boolean): string {
  if (converted) return WHATSAPP_AUDIO_META_UPLOAD_TYPE;
  const base = sourceMime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/ogg' || base === 'audio/opus') return WHATSAPP_AUDIO_META_UPLOAD_TYPE;
  if (base === 'audio/mpeg' || base === 'audio/mp3') return 'audio/mpeg';
  return WHATSAPP_AUDIO_META_UPLOAD_TYPE;
}

export { isWhatsAppReadyAudioMime, WHATSAPP_AUDIO_META_UPLOAD_TYPE };
