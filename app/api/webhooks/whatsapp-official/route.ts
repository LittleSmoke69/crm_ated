/**
 * Webhook WhatsApp Cloud API (Oficial)
 *
 * GET  — verificação (hub.verify_token / hub.challenge)
 * POST — eventos (mensagens recebidas, status updates)
 *
 * Sempre retorna 200 para a Meta (exige resposta < 5 s).
 * Registro do evento bruto em webhook_events é feito antes do processamento.
 */

import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

const SOURCE = 'whatsapp_official';
const EVENT_NAME = 'whatsapp_official';

// ---------------------------------------------------------------------------
// Tipos
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

interface WaValue {
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
  /** Unix em segundos, sempre como número */
  timestamp: number;
  phoneNumberId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWhatsAppOfficialPayload(
  payload: unknown
): payload is { object: string; entry?: unknown[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { object?: string }).object === 'whatsapp_business_account'
  );
}

/**
 * Extrai os campos relevantes de uma entrada de mensagem do payload Meta.
 * timestamp é sempre convertido com parseInt para garantir número.
 */
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
  if (msg.type === 'text' && msg.text?.body) {
    return { text: msg.text.body, mediaType: 'text', caption: '' };
  }
  if (msg.image) {
    return { text: msg.image.caption || '', mediaType: 'image', caption: msg.image.caption || '' };
  }
  if (msg.audio) {
    return { text: 'Áudio', mediaType: 'audio', caption: '' };
  }
  if (msg.video) {
    return { text: msg.video.caption || 'Vídeo', mediaType: 'video', caption: msg.video.caption || '' };
  }
  if (msg.document) {
    return {
      text: msg.document.caption || 'Documento',
      mediaType: 'document',
      caption: msg.document.caption || '',
    };
  }
  return { text: '', mediaType: msg.type, caption: '' };
}

const CHAT_MEDIA_BUCKET = 'chat-media';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

function getExtension(mimeType: string | undefined): string {
  if (!mimeType) return '.bin';
  const ext = MIME_TO_EXT[mimeType.toLowerCase()];
  return ext || '.bin';
}

/**
 * Obtém a mídia da Meta (URL temporária), baixa o binário e faz upload no Supabase Storage.
 * Retorna a URL pública permanente. Não salva URL temporária no banco.
 * Em falha, lança; o caller deve usar try/catch para não quebrar o webhook.
 */
async function resolveAndStoreMedia(
  mediaId: string,
  accessToken: string,
  graphVersion: string,
  mimeType: string | undefined,
  configId: string
): Promise<string> {
  const version = graphVersion.replace(/^v/, '');
  const mediaApiUrl = `https://graph.facebook.com/v${version}/${mediaId}`;

  const metaRes = await fetch(mediaApiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`[Zaploto Chat] Meta Media API ${metaRes.status}: ${errText}`);
  }
  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
  const tempUrl = metaJson?.url;
  if (!tempUrl || typeof tempUrl !== 'string') {
    throw new Error('[Zaploto Chat] Meta Media API não retornou url');
  }

  const downloadRes = await fetch(tempUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!downloadRes.ok) {
    throw new Error(`[Zaploto Chat] Falha ao baixar mídia: ${downloadRes.status}`);
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const contentType = metaJson.mime_type || mimeType || 'application/octet-stream';
  const ext = getExtension(metaJson.mime_type || mimeType);
  const storagePath = `${configId}/${mediaId}${ext}`;

  const { error: uploadError } = await supabaseServiceRole.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });

  if (uploadError) {
    console.error('[Zaploto Chat] Erro upload storage:', uploadError.message);
    throw new Error(`[Zaploto Chat] Storage upload: ${uploadError.message}`);
  }

  const { data: urlData } = supabaseServiceRole.storage
    .from(CHAT_MEDIA_BUCKET)
    .getPublicUrl(storagePath);
  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------
// GET — Verificação do webhook (Meta)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !challenge) {
    return new Response('Bad Request', { status: 400 });
  }

  const { data: config } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id')
    .eq('verify_token', token || '')
    .limit(1)
    .maybeSingle();

  if (!config) {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

// ---------------------------------------------------------------------------
// POST — Eventos de mensagens e status
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let payload: unknown;

  try {
    const rawBody = await req.text();
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!isWhatsAppOfficialPayload(payload)) {
      return new Response('OK', { status: 200 });
    }

    // Registrar evento bruto para auditoria / "Ver payload"
    const { error: insertError } = await supabaseServiceRole.from('webhook_events').insert({
      source: SOURCE,
      event_name: EVENT_NAME,
      raw_payload: payload as object,
    });

    if (insertError) {
      console.error(
        '[Zaploto Chat] Erro ao inserir webhook_event:',
        insertError.message,
        insertError.details
      );
      return new Response('OK', { status: 200 });
    }

    // Processar entradas em paralelo (Meta pode enviar múltiplas)
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
        ? (entry as { changes: unknown[] }).changes
        : [];

      for (const change of changes) {
        const value = (change as { value?: WaValue })?.value;
        if (!value || typeof value !== 'object') continue;

        try {
          if (Array.isArray(value.messages)) {
            await handleInboundMessages(value);
          }
          if (Array.isArray(value.statuses)) {
            await handleStatusUpdates(value);
          }
        } catch (err) {
          console.error('[Zaploto Chat] Erro ao processar entrada:', err);
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Zaploto Chat] Erro inesperado no webhook:', err);
    return new Response('OK', { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// Processamento de mensagens recebidas
// ---------------------------------------------------------------------------

async function handleInboundMessages(value: WaValue) {
  const messages = value.messages ?? [];
  if (messages.length === 0) return;

  // Extrair metadados do primeiro evento para resolver a config
  const parsed = parseWhatsAppPayload(value);
  if (!parsed) return;

  // Resolver whatsapp_config_id via phone_number_id (access_token e graph_version para resolveAndStoreMedia)
  const { data: config } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id, zaploto_id, access_token, graph_version')
    .eq('phone_number_id', parsed.phoneNumberId)
    .eq('is_active', true)
    .single();

  if (!config) {
    console.warn('[Zaploto Chat] Config não encontrada para phone_number_id:', parsed.phoneNumberId);
    return;
  }

  const contact = value.contacts?.[0];
  const remoteJid = `${parsed.contactId.replace(/\D/g, '')}@s.whatsapp.net`;
  const title = parsed.contactName || remoteJid;

  // UPSERT da conversa (campos mínimos; saveMessage atualiza o resumo depois)
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

  // Processar cada mensagem individualmente
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
          mediaUrl = await resolveAndStoreMedia(
            mediaId,
            accessToken,
            graphVersion,
            mimeType,
            config.id
          );
        } catch (err) {
          console.error('[Zaploto Chat] Falha ao resolver mídia:', mediaId, err);
        }
      }
    }

    // saveMessage: normaliza timestamp, deduplica e atualiza conversa
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

  // Incrementar contador de não lidas (atômico, evita race condition)
  try {
    const { error } = await supabaseServiceRole.rpc('increment_unread_count', {
      conv_id: conversation.id,
    });
    if (error) throw error;
  } catch {
    await supabaseServiceRole
      .from('chat_conversations')
      .update({ unread_count: (conversation.unread_count || 0) + messages.length })
      .eq('id', conversation.id);
  }
}

// ---------------------------------------------------------------------------
// Processamento de atualizações de status (sent/delivered/read/failed)
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

async function handleStatusUpdates(value: WaValue) {
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
