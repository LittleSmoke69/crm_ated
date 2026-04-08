/**
 * Processador de payloads do webhook WhatsApp Oficial (Meta).
 * Lê o raw_payload (ou o objeto já parseado) e organiza os dados em
 * chat_conversations e chat_messages.
 * Usado pelo webhook em tempo real e pela API de processamento a partir de webhook_events.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import {
  extensionForWhatsAppMedia,
  storageContentTypeForWhatsAppMedia,
} from '@/lib/services/whatsapp-official-media-mime';

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
  sticker?: { id?: string; mime_type?: string };
  reaction?: { message_id?: string; emoji?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  button?: { text?: string; payload?: string };
  interactive?: { type?: string; [key: string]: unknown };
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
const CONFIG_FETCH_MAX_RETRIES = 3;
const CONFIG_FETCH_BASE_DELAY_MS = 400;

/** Mensagem usada quando o token do WhatsApp Oficial está inválido/expirado (401). Usado para exibir alerta na UI. */
export const WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG =
  'Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.';

/** Reduz mensagem de erro para log: evita despejar HTML (ex.: página 502 Cloudflare/Supabase) no console. */
function sanitizeErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const maybe = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof maybe.code === 'string' && maybe.code.trim()) parts.push(`code=${maybe.code}`);
    if (typeof maybe.message === 'string' && maybe.message.trim()) parts.push(maybe.message);
    if (typeof maybe.details === 'string' && maybe.details.trim()) parts.push(`details=${maybe.details}`);
    if (typeof maybe.hint === 'string' && maybe.hint.trim()) parts.push(`hint=${maybe.hint}`);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.length > 500 || /<!DOCTYPE\s+html/i.test(msg) || /<html/i.test(msg)) {
    if (/502|Bad gateway/i.test(msg)) return 'Supabase indisponível (502 Bad Gateway). Tente novamente em alguns minutos.';
    if (/503|Service Unavailable/i.test(msg)) return 'Supabase indisponível (503). Tente novamente em alguns minutos.';
    return `Erro de rede/servidor (resposta inválida ou muito longa).`;
  }
  return msg;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientConfigFetchError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('ssl handshake failed') ||
    normalized.includes('error code 525') ||
    normalized.includes('bad gateway') ||
    normalized.includes('service unavailable') ||
    normalized.includes('gateway timeout') ||
    normalized.includes('connection terminated') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('enotfound') ||
    normalized.includes('cloudflare') ||
    normalized.includes('502') ||
    normalized.includes('503') ||
    normalized.includes('504') ||
    normalized.includes('525')
  );
}

type WhatsAppOfficialConfigRow = {
  id: string;
  zaploto_id: string;
  access_token?: string;
  graph_version?: string;
};

async function fetchActiveConfigByPhoneNumberId(
  phoneNumberIdStr: string
): Promise<{ config: WhatsAppOfficialConfigRow | null; errorMessage: string | null }> {
  for (let attempt = 1; attempt <= CONFIG_FETCH_MAX_RETRIES; attempt += 1) {
    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id, access_token, graph_version')
      .eq('phone_number_id', phoneNumberIdStr)
      .eq('is_active', true)
      .maybeSingle();

    if (!configError) {
      return { config: (config as WhatsAppOfficialConfigRow | null) ?? null, errorMessage: null };
    }

    const safeMessage = sanitizeErrorMessage(configError);
    const isTransient = isTransientConfigFetchError(safeMessage);
    const canRetry = isTransient && attempt < CONFIG_FETCH_MAX_RETRIES;
    if (canRetry) {
      const jitterMs = Math.floor(Math.random() * 120);
      const delayMs = CONFIG_FETCH_BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitterMs;
      console.warn(
        `[Zaploto Chat] Falha transitória ao buscar config por phone_number_id (${phoneNumberIdStr}), tentativa ${attempt}/${CONFIG_FETCH_MAX_RETRIES}. Retentando em ${delayMs}ms. Motivo: ${safeMessage}`
      );
      await sleep(delayMs);
      continue;
    }

    return { config: null, errorMessage: safeMessage };
  }

  return { config: null, errorMessage: 'Falha ao buscar configuração ativa após retentativas.' };
}

class WhatsAppOfficialProcessingError extends Error {
  readonly tokenAlert: boolean;
  readonly errors: string[];

  constructor(errors: string[], tokenAlert = false) {
    super(`Falhas no processamento do webhook oficial (${errors.length}): ${errors.join(' || ')}`);
    this.name = 'WhatsAppOfficialProcessingError';
    this.tokenAlert = tokenAlert;
    this.errors = errors;
  }
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
  if (msg.type === 'image' && msg.image) return { text: msg.image.caption || '', mediaType: 'image', caption: msg.image.caption || '' };
  if (msg.type === 'audio' && msg.audio) return { text: 'Áudio', mediaType: 'audio', caption: '' };
  if (msg.type === 'video' && msg.video) return { text: msg.video.caption || 'Vídeo', mediaType: 'video', caption: msg.video.caption || '' };
  if (msg.type === 'document' && msg.document) return { text: msg.document.caption || 'Documento', mediaType: 'document', caption: msg.document.caption || '' };
  if (msg.type === 'sticker') return { text: '🖼️ Figurinha', mediaType: 'image', caption: '' };
  if (msg.type === 'reaction') return { text: msg.reaction?.emoji || '👍', mediaType: 'text', caption: '' };
  if (msg.type === 'location') {
    const loc = msg.location;
    const label = loc?.name || loc?.address || `${loc?.latitude ?? 0},${loc?.longitude ?? 0}`;
    return { text: `📍 ${label}`, mediaType: 'text', caption: '' };
  }
  if (msg.type === 'contacts') return { text: '👤 Contato compartilhado', mediaType: 'text', caption: '' };
  if (msg.type === 'button') return { text: msg.button?.text || 'Botão', mediaType: 'text', caption: '' };
  if (msg.type === 'interactive') return { text: 'Resposta interativa', mediaType: 'text', caption: '' };
  return { text: `[${msg.type}]`, mediaType: 'text', caption: '' };
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

/** Timeouts de TCP/TLS para graph.facebook.com (undici) — permite nova tentativa em vez de falhar o webhook. */
function isMetaConnectTimeoutError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 12 && e != null; i += 1) {
    if (typeof e === 'object' && e !== null) {
      const o = e as { code?: string; name?: string; message?: string; cause?: unknown };
      if (o.code === 'UND_ERR_CONNECT_TIMEOUT') return true;
      if (o.name === 'ConnectTimeoutError') return true;
      const msg = (o.message ?? '').toLowerCase();
      if (msg.includes('connect timeout')) return true;
      e = o.cause;
    } else {
      break;
    }
  }
  return false;
}

async function resolveAndStoreMediaOnce(
  mediaId: string,
  accessToken: string,
  graphVersion: string,
  mimeType: string | undefined,
  configId: string,
  mediaCategory: 'audio' | 'image' | 'video' | 'document' | 'sticker'
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
  const mimeFromMeta = metaJson.mime_type || mimeType;
  const ext = extensionForWhatsAppMedia(mimeFromMeta, mediaCategory);
  const contentType = storageContentTypeForWhatsAppMedia(mimeFromMeta, ext, mediaCategory);
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
  configId: string,
  mediaCategory: 'audio' | 'image' | 'video' | 'document' | 'sticker'
): Promise<string | null> {
  for (let attempt = 0; attempt <= MEDIA_MAX_RETRIES; attempt++) {
    try {
      const url = await resolveAndStoreMediaOnce(
        mediaId,
        accessToken,
        graphVersion,
        mimeType,
        configId,
        mediaCategory
      );
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
      if (isMetaConnectTimeoutError(err) || msg.toLowerCase().includes('fetch failed')) {
        console.warn(
          `[Zaploto Chat] Rede/timeout ao falar com a Meta para mídia ${mediaId} (tentativa ${attempt + 1}/${MEDIA_MAX_RETRIES + 1})`
        );
        if (attempt < MEDIA_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, MEDIA_RETRY_DELAY_MS));
          continue;
        }
        return null;
      }
      throw err;
    }
  }
  return null;
}

async function handleInboundMessages(value: WaValue): Promise<{ tokenAlert: boolean; errors: string[] }> {
  const messages = value.messages ?? [];
  if (messages.length === 0) return { tokenAlert: false, errors: [] };

  const metadata = value.metadata;
  const phoneNumberIdStr = String(metadata?.phone_number_id ?? '').trim();
  if (!phoneNumberIdStr) {
    console.warn('[Zaploto Chat] Evento sem phone_number_id no metadata, descartando.');
    return { tokenAlert: false, errors: ['Evento sem phone_number_id no metadata'] };
  }

  const { config, errorMessage } = await fetchActiveConfigByPhoneNumberId(phoneNumberIdStr);
  if (errorMessage) {
    console.error('[Zaploto Chat] Erro ao buscar config por phone_number_id:', errorMessage);
    return { tokenAlert: false, errors: [errorMessage] };
  }
  if (!config) {
    console.warn('[Zaploto Chat] Config não encontrada para phone_number_id:', phoneNumberIdStr);
    return { tokenAlert: false, errors: [`Config não encontrada para phone_number_id: ${phoneNumberIdStr}`] };
  }

  const contactsMap = new Map<string, string>();
  for (const c of value.contacts ?? []) {
    if (c.wa_id) contactsMap.set(c.wa_id, c.profile?.name ?? c.wa_id);
  }

  const graphVersion = (config as { graph_version?: string }).graph_version || 'v25.0';
  const accessToken = (config as { access_token?: string }).access_token || '';
  let tokenAlert = false;
  const errors: string[] = [];

  // Agrupa mensagens por remetente para criar conversas corretas
  const byContact = new Map<string, WaMessage[]>();
  for (const msg of messages) {
    const from = String(msg.from || '').replace(/\D/g, '');
    if (!from) continue;
    const list = byContact.get(from) ?? [];
    list.push(msg);
    byContact.set(from, list);
  }

  for (const [contactNumber, contactMessages] of byContact) {
    const remoteJid = `${contactNumber}@s.whatsapp.net`;
    const title = contactsMap.get(contactNumber) ?? contactNumber;

    const latestTimestamp = Math.max(...contactMessages.map((m) => parseInt(m.timestamp, 10) || 0));
    const lastMsgAt = latestTimestamp > 0
      ? new Date(latestTimestamp * 1000).toISOString()
      : new Date().toISOString();

    let conversation: { id: string; unread_count?: number };
    try {
      conversation = await chatService.upsertConversation({
        whatsapp_config_id: config.id,
        instance_id: null,
        workspace_id: config.zaploto_id,
        remote_jid: remoteJid,
        title,
        is_group: false,
        last_message_at: lastMsgAt,
      });
    } catch (err) {
      errors.push(`Falha ao upsertConversation ${remoteJid}: ${sanitizeErrorMessage(err)}`);
      continue;
    }

    for (const msg of contactMessages) {
      const from = String(msg.from || '').replace(/\D/g, '');
      const { text, mediaType, caption } = resolveMediaInfo(msg);
      let mediaUrl: string | null = null;

      if (['image', 'audio', 'video', 'document', 'sticker'].includes(msg.type)) {
        const mediaObj = msg[msg.type as keyof WaMessage] as { id?: string; mime_type?: string } | undefined;
        const mediaId = mediaObj?.id;
        const mimeType = mediaObj?.mime_type;
        if (mediaId && accessToken) {
          try {
            mediaUrl = await resolveAndStoreMedia(
              mediaId,
              accessToken,
              graphVersion,
              mimeType,
              config.id,
              msg.type as 'image' | 'audio' | 'video' | 'document' | 'sticker'
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes(WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG)) {
              tokenAlert = true;
              console.warn('[Zaploto Chat] Token inválido/expirado ao baixar mídia; mensagem será salva sem mídia.');
            } else {
              console.error('[Zaploto Chat] Falha ao resolver mídia:', mediaId, err);
            }
          }
        }
      }

      try {
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
      } catch (err) {
        errors.push(`Falha ao salvar mensagem ${msg.id}: ${sanitizeErrorMessage(err)}`);
      }
    }

    try {
      await supabaseServiceRole.rpc('increment_unread_count', { conv_id: conversation.id });
    } catch {
      await supabaseServiceRole
        .from('chat_conversations')
        .update({ unread_count: (conversation.unread_count || 0) + contactMessages.length })
        .eq('id', conversation.id);
    }
  }

  return { tokenAlert, errors };
}

/** Statuses da Meta → valores da UI / coluna chat_messages.status (evita gravar "updated" e quebrar ícones). */
const STATUS_MAP: Record<string, string> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  deleted: 'failed',
  /** Áudio: destinatário reproduziu — equivalente a "lido" para ticks. */
  played: 'read',
  listened: 'read',
  pending: 'sent',
};

async function handleStatusUpdates(value: WaValue): Promise<void> {
  const statuses = value.statuses ?? [];
  for (const st of statuses) {
    const raw = String(st.status ?? '')
      .trim()
      .toLowerCase();
    const newStatus =
      raw && STATUS_MAP[raw] !== undefined ? STATUS_MAP[raw] : raw ? raw : 'sent';
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
 * Idempotente para mensagens (saveMessage usa upsert com ON CONFLICT UPDATE).
 * Retorna tokenAlert: true se houve erro de token ao baixar mídia (para a API sinalizar alerta na UI).
 */
export async function processMetaPayloadToChat(payload: unknown): Promise<{ tokenAlert?: boolean }> {
  if (!isWhatsAppOfficialPayload(payload)) return {};
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let tokenAlert = false;
  const processingErrors: string[] = [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes) ? (entry as { changes: unknown[] }).changes : [];
    for (const change of changes) {
      const value = (change as { value?: WaValue })?.value;
      if (!value || typeof value !== 'object') continue;
      try {
        if (Array.isArray(value.messages)) {
          const inboundResult = await handleInboundMessages(value);
          if (inboundResult.tokenAlert) tokenAlert = true;
          if (inboundResult.errors.length > 0) {
            processingErrors.push(...inboundResult.errors);
          }
        }
        if (Array.isArray(value.statuses)) await handleStatusUpdates(value);
      } catch (err) {
        processingErrors.push(sanitizeErrorMessage(err));
      }
    }
  }
  if (processingErrors.length > 0) {
    throw new WhatsAppOfficialProcessingError(processingErrors, tokenAlert);
  }
  return tokenAlert ? { tokenAlert: true } : {};
}
