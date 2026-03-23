/**
 * WhatsApp Cloud API (Oficial) - envio de mensagens
 * Nunca logar access_token.
 */

const SEND_TIMEOUT_MS = 20_000;
const DEFAULT_GRAPH_VERSION = 'v25.0';

export interface WhatsAppOfficialConfig {
  id: string;
  phone_number_id: string;
  waba_id: string;
  graph_version: string;
  access_token: string;
}

function buildUrl(config: WhatsAppOfficialConfig, path: string): string {
  const base = 'https://graph.facebook.com';
  const version = (config.graph_version || DEFAULT_GRAPH_VERSION).replace(/^v/, '');
  return `${base}/v${version}/${config.phone_number_id}${path}`;
}

function sanitizeMetaResponseText(text: string): string {
  // Evita logs gigantes (HTML inteiro, payloads longos etc.)
  return text.length > 2000 ? `${text.slice(0, 2000)}... [truncated]` : text;
}

async function postMessages(
  config: WhatsAppOfficialConfig,
  payload: Record<string, unknown>,
  logContext: string
): Promise<{ messages: Array<{ id: string }> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  const url = buildUrl(config, '/messages');

  // Log de request sem token
  console.info(`[WA Official][${logContext}] request`, {
    url,
    phone_number_id: config.phone_number_id,
    graph_version: config.graph_version || DEFAULT_GRAPH_VERSION,
    payload,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await res.text();
  const safeText = sanitizeMetaResponseText(rawText);
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = rawText || null;
  }

  console.info(`[WA Official][${logContext}] response`, {
    status: res.status,
    ok: res.ok,
    body: parsed ?? safeText,
  });

  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${safeText}`);
  }

  if (parsed && typeof parsed === 'object') {
    return parsed as { messages: Array<{ id: string }> };
  }
  return { messages: [] };
}

export async function sendText(
  config: WhatsAppOfficialConfig,
  to: string,
  text: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  return postMessages(config, body, 'sendText');
}

export async function sendImage(
  config: WhatsAppOfficialConfig,
  to: string,
  mediaUrl: string,
  caption?: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'image',
    image: {
      link: mediaUrl,
      ...(caption ? { caption } : {}),
    },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  return postMessages(config, body, 'sendImage');
}

export async function sendVideo(
  config: WhatsAppOfficialConfig,
  to: string,
  mediaUrl: string,
  caption?: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'video',
    video: {
      link: mediaUrl,
      ...(caption ? { caption } : {}),
    },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  return postMessages(config, body, 'sendVideo');
}

export async function sendDocument(
  config: WhatsAppOfficialConfig,
  to: string,
  mediaUrl: string,
  caption?: string,
  filename?: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'document',
    document: {
      link: mediaUrl,
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
    },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  return postMessages(config, body, 'sendDocument');
}

export async function sendAudio(
  config: WhatsAppOfficialConfig,
  to: string,
  media: { link: string } | { id: string },
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'audio',
    audio: media,
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  return postMessages(config, body, `sendAudio:${'id' in media ? 'media_id' : 'link'}`);
}
