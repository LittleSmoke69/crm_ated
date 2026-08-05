/**
 * evolution-media-persist.ts
 *
 * Mídia recebida/enviada via Evolution → bucket público `chat-media`.
 *
 * O payload de MESSAGES_UPSERT/SEND_MESSAGE traz `message.base64` (webhook com base64
 * ligado) e a `url` do nó de mídia aponta para o CDN do WhatsApp com sufixo `.enc` —
 * cifrada e inútil sem a mediaKey. A base64 é, portanto, a única fonte utilizável:
 * decodifica, sobe para o Storage e aponta `chat_messages.media_url` para a URL pública.
 *
 * Sem este passo a linha fica com `media_url` nulo e o chat de atendimento mostra
 * "🎵 Áudio não disponível" (idem imagem/vídeo/documento).
 *
 * Nunca lança: mídia é acessório, a ingestão do webhook não pode cair por causa dela.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

const CHAT_MEDIA_BUCKET = 'chat-media';

/** Nó de mídia no `message` → `chat_messages.media_type`. */
const MEDIA_NODE_KEYS = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
} as const;

type MediaNodeKey = keyof typeof MEDIA_NODE_KEYS;

const EXT_BY_MIME: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.m4a',
  'audio/amr': '.amr',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

const DEFAULT_EXT: Record<MediaNodeKey, string> = {
  audioMessage: '.ogg',
  imageMessage: '.jpg',
  videoMessage: '.mp4',
  documentMessage: '.bin',
  documentWithCaptionMessage: '.bin',
  stickerMessage: '.webp',
};

export type EvolutionMediaSource = {
  nodeKey: MediaNodeKey;
  /** Valor gravado em `chat_messages.media_type`. */
  mediaType: (typeof MEDIA_NODE_KEYS)[MediaNodeKey];
  /** Mime sem parâmetros (`audio/ogg`, não `audio/ogg; codecs=opus`). */
  mimeType: string;
  base64: string;
  fileName: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extensionFor(nodeKey: MediaNodeKey, mimeType: string, fileName: string | null): string {
  const fromMime = EXT_BY_MIME[mimeType];
  if (fromMime) return fromMime;
  const fromName = fileName?.match(/\.[a-z0-9]{1,8}$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  return DEFAULT_EXT[nodeKey];
}

/**
 * Localiza o nó de mídia e a base64 no `message` do payload.
 * `extraBase64` cobre versões da Evolution que colocam a base64 em `data.base64`.
 */
export function extractEvolutionMediaSource(
  message: unknown,
  extraBase64?: unknown
): EvolutionMediaSource | null {
  const msg = asObject(message);
  if (!msg) return null;

  const nodeKey = (Object.keys(MEDIA_NODE_KEYS) as MediaNodeKey[]).find((k) => asObject(msg[k]));
  if (!nodeKey) return null;

  const base64 = str(msg.base64) ?? str(extraBase64);
  if (!base64) return null;

  // documentWithCaptionMessage embrulha o documento em `message.documentMessage`.
  const outer = asObject(msg[nodeKey]) ?? {};
  const node = asObject(asObject(outer.message)?.documentMessage) ?? outer;

  return {
    nodeKey,
    mediaType: MEDIA_NODE_KEYS[nodeKey],
    mimeType: (str(node.mimetype) || 'application/octet-stream').split(';')[0].toLowerCase(),
    base64,
    fileName: str(node.fileName) ?? str(node.title),
  };
}

/**
 * Sobe a mídia do payload e aponta `chat_messages.media_url` para a URL pública.
 * Retorna a URL, ou null quando não havia mídia / o upload falhou.
 */
export async function persistEvolutionMedia(params: {
  /** Preferido: id da linha salva por `saveMessage`. */
  chatMessageId?: string | null;
  /** Fallback de identificação (wamid) quando não temos o id da linha. */
  messageId?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
  /** `data.message` do payload. */
  message: unknown;
  /** `data` do payload — só para achar `data.base64` em versões antigas. */
  data?: unknown;
  /** Pré-extraído por quem chamou, para não repetir o parse. */
  source?: EvolutionMediaSource | null;
}): Promise<string | null> {
  const { chatMessageId, messageId, instanceId, instanceName } = params;
  try {
    if (!chatMessageId && !messageId) return null;

    const source =
      params.source ??
      extractEvolutionMediaSource(params.message, asObject(params.data)?.base64);
    if (!source) return null;

    const buffer = Buffer.from(source.base64, 'base64');
    if (!buffer.length) {
      console.warn(`⚠️ [EVO MEDIA] base64 vazia (messageId=${messageId})`);
      return null;
    }

    const ext = extensionFor(source.nodeKey, source.mimeType, source.fileName);
    const folder = (instanceName || instanceId || 'sem-instancia').replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileStem = String(messageId || chatMessageId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `evolution/${folder}/${source.nodeKey}/${fileStem}${ext}`;

    const { error: uploadError } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: source.mimeType, upsert: true });

    if (uploadError) {
      // Mime fora de `allowed_mime_types` do bucket cai aqui (ex.: .docx, .xlsx).
      console.warn(
        `⚠️ [EVO MEDIA] Upload falhou (${source.mimeType}, messageId=${messageId}): ${uploadError.message}`
      );
      return null;
    }

    const { data: urlData } = supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    const patch = {
      media_url: publicUrl,
      media_mime_type: source.mimeType,
      media_filename: source.fileName,
      media_recovery_status: 'ready' as const,
    };

    const query = supabaseServiceRole.from('chat_messages').update(patch);
    const { error: updateError } = chatMessageId
      ? await query.eq('id', chatMessageId)
      : await query.eq('message_id', messageId!).eq('provider', 'evolution').is('media_url', null);

    if (updateError) {
      console.error(`❌ [EVO MEDIA] Falha ao gravar media_url (messageId=${messageId}):`, updateError.message);
      return null;
    }

    return publicUrl;
  } catch (err) {
    console.error(`❌ [EVO MEDIA] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
