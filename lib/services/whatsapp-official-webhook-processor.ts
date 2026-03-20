/**
 * Processador de payloads do webhook WhatsApp Oficial (Meta).
 * Lê o raw_payload (ou o objeto já parseado) e organiza os dados em
 * chat_conversations e chat_messages.
 * Usado pelo webhook em tempo real e pela API de processamento a partir de webhook_events.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

// ---------------------------------------------------------------------------
// Tipos (espelho do payload Meta)
// ---------------------------------------------------------------------------

interface WaContact {
  wa_id?: string;
  profile?: { name?: string };
}

interface WaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; mime_type?: string };
}

interface WaMetadata {
  phone_number_id?: string;
  display_phone_number?: string;
}

export interface WaValue {
  metadata?: WaMetadata;
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: Array<{ id: string; status?: string; recipient_id?: string }>;
}

interface ParsedMessage {
  contactId: string;
  contactName: string;
  messageId: string;
  messageBody: string | null;
  messageType: string;
  timestamp: number;
  phoneNumberId: string;
}

const CHAT_MEDIA_BUCKET = 'chat-media';

/** Mensagem usada quando o token do WhatsApp Oficial está inválido/expirado (401). Usado para exibir alerta na UI. */
export const WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG =
  'Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.';

/** Reduz mensagem de erro para log: evita despejar HTML (ex.: página 502 Cloudflare/Supabase) no console. */
function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.length > 500 || /<!DOCTYPE\s+html/i.test(msg) || /<html/i.test(msg)) {
    if (/502|Bad gateway/i.test(msg)) return 'Supabase indisponível (502 Bad Gateway). Tente novamente em alguns minutos.';
    if (/503|Service Unavailable/i.test(msg)) return 'Supabase indisponível (503). Tente novamente em alguns minutos.';
    return `Erro de rede/servidor (resposta inválida ou muito longa).`;
  }
  return msg;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'application/pdf': '.pdf',
};

function getExtension(mimeType: string | undefined): string {
  if (!mimeType) return '.bin';
  const ext = MIME_TO_EXT[mimeType.toLowerCase()];
  return ext || '.bin';
}

function parseWhatsAppPayload(value: WaValue): ParsedMessage | null {
  const msg = value.messages?.[0];
  const contact = value.contacts?.[0];
  const metadata = value.metadata;
  if (!msg || !metadata?.phone_number_id) return null;
  return {
    contactId: contact?.wa_id ?? msg.from,
    contactName: contact?.profile?.name ?? msg.from,
    messageId: msg.id,
    messageBody: msg.text?.body ?? null,
    messageType: msg.type,
    timestamp: parseInt(msg.timestamp, 10),
    phoneNumberId: metadata.phone_number_id,
  };
}

function resolveMediaInfo(msg: WaMessage): { text: string; mediaType: string; caption: string } {
  if (msg.type === 'text' && msg.text?.body) return { text: msg.text.body, mediaType: 'text', caption: '' };
  if (msg.image) return { text: msg.image.caption || '', mediaType: 'image', caption: msg.image.caption || '' };
  if (msg.audio) return { text: 'Áudio', mediaType: 'audio', caption: '' };
  if (msg.video) return { text: msg.video.caption || 'Vídeo', mediaType: 'video', caption: msg.video.caption || '' };
  if (msg.document) return { text: msg.document.caption || 'Documento', mediaType: 'document', caption: msg.document.caption || '' };
  return { text: '', mediaType: msg.type, caption: '' };
}

const MEDIA_FETCH_TIMEOUT_MS = 15_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
const MEDIA_MAX_RETRIES = 1;
const MEDIA_RETRY_DELAY_MS = 2_000;

function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function resolveAndStoreMediaOnce(
  mediaId: string,
  accessToken: string,
  graphVersion: string,
  mimeType: string | undefined,
  configId: string
): Promise<string | null> {
  const version = graphVersion.replace(/^v/, '');
  const mediaApiUrl = `https://graph.facebook.com/v${version}/${mediaId}`;
  const metaRes = await fetchWithTimeout(
    mediaApiUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    MEDIA_FETCH_TIMEOUT_MS,
  );
  if (!metaRes.ok) {
    await metaRes.text();
    if (metaRes.status === 401) {
      throw new Error(`[Zaploto Chat] ${WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG}`);
    }
    if (metaRes.status >= 500) {
      console.warn(`[Zaploto Chat] Meta Media API ${metaRes.status} para mídia ${mediaId}; salva sem mídia.`);
    }
    return null;
  }
  let metaJson: { url?: string; mime_type?: string };
  try {
    metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
  } catch {
    return null;
  }
  const tempUrl = metaJson?.url;
  if (!tempUrl || typeof tempUrl !== 'string') {
    return null;
  }
  const downloadRes = await fetchWithTimeout(
    tempUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    MEDIA_DOWNLOAD_TIMEOUT_MS,
  );
  if (!downloadRes.ok) {
    if (downloadRes.status >= 500) {
      console.warn(`[Zaploto Chat] Falha ao baixar mídia ${mediaId}: ${downloadRes.status}`);
    }
    return null;
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const contentType = metaJson.mime_type || mimeType || 'application/octet-stream';
  const ext = getExtension(metaJson.mime_type || mimeType);
  const storagePath = `${configId}/${mediaId}${ext}`;
  const { error: uploadError } = await supabaseServiceRole.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (uploadError) {
    console.warn('[Zaploto Chat] Storage upload para mídia', mediaId, uploadError.message);
    return null;
  }
  const { data: urlData } = supabaseServiceRole.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(storagePath);
  return urlData.publicUrl;
}

async function resolveAndStoreMedia(
  mediaId: string,
  accessToken: string,
  graphVersion: string,
  mimeType: string | undefined,
  configId: string
): Promise<string | null> {
  for (let attempt = 0; attempt <= MEDIA_MAX_RETRIES; attempt++) {
    try {
      const url = await resolveAndStoreMediaOnce(mediaId, accessToken, graphVersion, mimeType, configId);
      if (url) return url;
      if (attempt < MEDIA_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, MEDIA_RETRY_DELAY_MS));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes(WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG)) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn(`[Zaploto Chat] Timeout ao baixar mídia ${mediaId} (tentativa ${attempt + 1})`);
        if (attempt < MEDIA_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, MEDIA_RETRY_DELAY_MS));
        }
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function handleInboundMessages(value: WaValue): Promise<boolean> {
  const messages = value.messages ?? [];
  if (messages.length === 0) return false;
  const parsed = parseWhatsAppPayload(value);
  if (!parsed) return false;
  const phoneNumberIdStr = String(parsed.phoneNumberId ?? '').trim();
  const { data: config, error: configError } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id, zaploto_id, access_token, graph_version')
    .eq('phone_number_id', phoneNumberIdStr)
    .eq('is_active', true)
    .maybeSingle();
  if (configError) {
    console.error('[Zaploto Chat] Erro ao buscar config por phone_number_id:', configError.message);
    return false;
  }
  if (!config) {
    console.warn('[Zaploto Chat] Config não encontrada para phone_number_id:', phoneNumberIdStr);
    return false;
  }
  const remoteJid = `${parsed.contactId.replace(/\D/g, '')}@s.whatsapp.net`;
  const title = parsed.contactName || remoteJid;
  const conversation = await chatService.upsertConversation({
    whatsapp_config_id: config.id,
    instance_id: null,
    workspace_id: config.zaploto_id,
    remote_jid: remoteJid,
    title,
    is_group: false,
  });
  const graphVersion = (config as { graph_version?: string }).graph_version || 'v25.0';
  const accessToken = (config as { access_token?: string }).access_token || '';
  let tokenAlert = false;
  for (const msg of messages) {
    const from = String(msg.from || '').replace(/\D/g, '');
    const { text, mediaType, caption } = resolveMediaInfo(msg);
    let mediaUrl: string | null = null;
    if (['image', 'audio', 'video', 'document'].includes(msg.type)) {
      const mediaObj = msg[msg.type as keyof WaMessage] as { id?: string; mime_type?: string } | undefined;
      const mediaId = mediaObj?.id;
      const mimeType = mediaObj?.mime_type;
      if (mediaId && accessToken) {
        try {
          mediaUrl = await resolveAndStoreMedia(mediaId, accessToken, graphVersion, mimeType, config.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes(WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG)) {
            tokenAlert = true;
            console.warn('[Zaploto Chat] Token inválido/expirado ao baixar mídia; mensagem será salva sem mídia. Renove em Admin > WhatsApp Oficial.');
          } else {
            console.error('[Zaploto Chat] Falha ao resolver mídia:', mediaId, err);
          }
        }
      }
    }
    await chatService.saveMessage({
      instance_id: null,
      whatsapp_config_id: config.id,
      workspace_id: config.zaploto_id,
      conversation_id: conversation.id,
      message_id: msg.id,
      direction: 'in',
      from_me: false,
      sender_jid: `${from}@s.whatsapp.net`,
      text,
      media_type: mediaType,
      media_url: mediaUrl ?? undefined,
      caption,
      status: 'received',
      timestamp: parseInt(msg.timestamp, 10),
      provider: 'whatsapp_official',
    });
  }
  try {
    await supabaseServiceRole.rpc('increment_unread_count', { conv_id: conversation.id });
  } catch {
    await supabaseServiceRole
      .from('chat_conversations')
      .update({ unread_count: (conversation.unread_count || 0) + messages.length })
      .eq('id', conversation.id);
  }
  return tokenAlert;
}

const STATUS_MAP: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };

async function handleStatusUpdates(value: WaValue): Promise<void> {
  const statuses = value.statuses ?? [];
  for (const st of statuses) {
    const newStatus = STATUS_MAP[st.status ?? ''] ?? st.status ?? 'updated';
    await supabaseServiceRole
      .from('chat_messages')
      .update({ status: newStatus })
      .eq('message_id', st.id)
      .eq('provider', 'whatsapp_official');
  }
}

function isWhatsAppOfficialPayload(payload: unknown): payload is { object: string; entry?: unknown[] } {
  return typeof payload === 'object' && payload !== null && (payload as { object?: string }).object === 'whatsapp_business_account';
}

/**
 * Processa o payload bruto da Meta (objeto com entry[].changes[].value)
 * e organiza os dados em chat_conversations e chat_messages.
 * Idempotente para mensagens (saveMessage usa upsert com ignoreDuplicates).
 * Retorna tokenAlert: true se houve erro de token ao baixar mídia (para a API sinalizar alerta na UI).
 */
export async function processMetaPayloadToChat(payload: unknown): Promise<{ tokenAlert?: boolean }> {
  if (!isWhatsAppOfficialPayload(payload)) return {};
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let tokenAlert = false;
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes) ? (entry as { changes: unknown[] }).changes : [];
    for (const change of changes) {
      const value = (change as { value?: WaValue })?.value;
      if (!value || typeof value !== 'object') continue;
      try {
        if (Array.isArray(value.messages)) {
          const hadTokenError = await handleInboundMessages(value);
          if (hadTokenError) tokenAlert = true;
        }
        if (Array.isArray(value.statuses)) await handleStatusUpdates(value);
      } catch (err) {
        console.error('[Zaploto Chat] Erro ao processar entrada:', sanitizeErrorMessage(err));
      }
    }
  }
  return tokenAlert ? { tokenAlert: true } : {};
}
