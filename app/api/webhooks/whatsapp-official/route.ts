/**
 * Webhook WhatsApp Cloud API (Oficial)
 * GET: verificação (hub.verify_token / hub.challenge)
 * POST: eventos (mensagens recebidas, status updates)
 * Eventos são filtrados por object === 'whatsapp_business_account' e registrados como source whatsapp_official.
 */

import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

const SOURCE = 'whatsapp_official';
const EVENT_NAME = 'whatsapp_official';

function isWhatsAppOfficialPayload(payload: unknown): payload is { object: string; entry?: unknown[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { object?: string }).object === 'whatsapp_business_account'
  );
}

/**
 * GET - Verificação do webhook (Meta)
 */
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

  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * POST - Eventos (mensagens, status)
 * Sempre persiste o evento primeiro; depois processa. Em falha de processamento
 * retorna 200 e loga o erro para depuração (evento fica visível em "Ver payload").
 */
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

    // 1) Sempre registrar o evento para aparecer na lista e permitir "Ver payload"
    const { error: insertError } = await supabaseServiceRole.from('webhook_events').insert({
      source: SOURCE,
      event_name: EVENT_NAME,
      raw_payload: payload as object,
    });
    if (insertError) {
      console.error('[webhooks/whatsapp-official] Erro ao inserir evento:', insertError.message, insertError.details);
      return new Response('OK', { status: 200 });
    }

    // 2) Processar entradas (mensagens → chat; status updates)
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
        ? (entry as { changes: unknown[] }).changes
        : [];
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> })?.value;
        if (!value || typeof value !== 'object') continue;

        try {
          if (Array.isArray(value.messages)) {
            await handleInboundMessages(value as InboundValue);
          }
          if (Array.isArray(value.statuses)) {
            await handleStatusUpdates(value as StatusValue);
          }
        } catch (err) {
          console.error('[webhooks/whatsapp-official] Erro ao processar entrada (mensagens/status):', err);
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[webhooks/whatsapp-official] Erro inesperado:', err);
    return new Response('OK', { status: 200 });
  }
}

interface InboundValue {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body?: string };
    image?: { id?: string; caption?: string };
    audio?: { id?: string };
    video?: { id?: string; caption?: string };
    document?: { id?: string; caption?: string };
  }>;
}

async function handleInboundMessages(value: InboundValue) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const { data: config } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id, zaploto_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('is_active', true)
    .single();

  if (!config) return;

  const messages = value.messages || [];
  const contact = value.contacts?.[0];
  const remoteJid = `${(messages[0]?.from || contact?.wa_id || '').replace(/\D/g, '')}@s.whatsapp.net`;
  const title = contact?.profile?.name || messages[0]?.from || remoteJid;

  const conversationData = {
    whatsapp_config_id: config.id,
    instance_id: null,
    workspace_id: config.zaploto_id,
    user_id: undefined,
    remote_jid: remoteJid,
    title,
    is_group: false,
    last_message_at: new Date().toISOString(),
    last_message_preview: '',
  };

  const conversation = await chatService.upsertConversation(conversationData);

  for (const msg of messages) {
    const from = String(msg.from || '').replace(/\D/g, '');
    let text = '';
    let mediaType = 'text';
    let caption = '';

    if (msg.type === 'text' && msg.text?.body) {
      text = msg.text.body;
    } else if (msg.image) {
      mediaType = 'image';
      text = msg.image.caption || '';
      caption = msg.image.caption || '';
    } else if (msg.audio) {
      mediaType = 'audio';
      text = 'Áudio';
    } else if (msg.video) {
      mediaType = 'video';
      text = msg.video.caption || 'Vídeo';
      caption = msg.video.caption || '';
    } else if (msg.document) {
      mediaType = 'document';
      text = msg.document.caption || 'Documento';
      caption = msg.document.caption || '';
    }

    conversationData.last_message_preview = text.slice(0, 100) || (mediaType !== 'text' ? mediaType : '');

    const messageData = {
      instance_id: null,
      whatsapp_config_id: config.id,
      workspace_id: config.zaploto_id,
      user_id: undefined,
      conversation_id: conversation.id,
      message_id: msg.id,
      direction: 'in' as const,
      from_me: false,
      sender_jid: `${from}@s.whatsapp.net`,
      text,
      media_type: mediaType,
      media_url: undefined,
      caption,
      status: 'received',
      timestamp: parseInt(String(msg.timestamp), 10) || Math.floor(Date.now() / 1000),
      provider: 'whatsapp_official' as const,
    };

    await chatService.saveMessage(messageData);
  }

  await Promise.resolve(
    supabaseServiceRole.rpc('increment_unread_count', { conv_id: conversation.id })
  ).catch(() =>
    supabaseServiceRole
      .from('chat_conversations')
      .update({ unread_count: (conversation.unread_count || 0) + 1 })
      .eq('id', conversation.id)
  );
}

interface StatusValue {
  statuses?: Array<{
    id: string;
    status?: string;
    recipient_id?: string;
  }>;
}

const STATUS_MAP: Record<string, string> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

async function handleStatusUpdates(value: StatusValue) {
  const statuses = value.statuses || [];
  for (const st of statuses) {
    const newStatus = STATUS_MAP[st.status || ''] || st.status || 'updated';
    await supabaseServiceRole
      .from('chat_messages')
      .update({ status: newStatus })
      .eq('message_id', st.id)
      .eq('provider', 'whatsapp_official');
  }
}
