/**
 * WhatsApp Cloud API (Oficial) - envio de mensagens
 * Nunca logar access_token.
 */

const SEND_TIMEOUT_MS = 20_000;

export interface WhatsAppOfficialConfig {
  id: string;
  phone_number_id: string;
  waba_id: string;
  graph_version: string;
  access_token: string;
}

function buildUrl(config: WhatsAppOfficialConfig, path: string): string {
  const base = 'https://graph.facebook.com';
  const version = config.graph_version.replace(/^v/, '');
  return `${base}/v${version}/${config.phone_number_id}${path}`;
}

export async function sendText(
  config: WhatsAppOfficialConfig,
  to: string,
  text: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  const res = await fetch(buildUrl(config, '/messages'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${errText}`);
  }

  return res.json();
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  const res = await fetch(buildUrl(config, '/messages'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${errText}`);
  }

  return res.json();
}

export async function sendAudio(
  config: WhatsAppOfficialConfig,
  to: string,
  mediaUrl: string,
  replyToMessageId?: string
): Promise<{ messages: Array<{ id: string }> }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'audio',
    audio: { link: mediaUrl },
  };
  if (replyToMessageId) {
    body.context = { message_id: replyToMessageId };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  const res = await fetch(buildUrl(config, '/messages'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${errText}`);
  }

  return res.json();
}
