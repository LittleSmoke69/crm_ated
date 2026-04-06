/**
 * evolution-webhook-processor.ts
 *
 * Processa payloads de eventos da Evolution API (lidos da tabela evolution_webhook_events)
 * em chat_conversations + chat_messages.
 *
 * Espelhado de whatsapp-official-webhook-processor.ts para manter consistência.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import {
  extractEvolutionWebhookInstanceName,
  normalizeEvolutionChatWebhookEvent,
} from '@/lib/server/evolution-chat-webhook-config';

/** Tipos de evento da Evolution que são relevantes para o chat. */
const CHAT_EVENT_TYPES = new Set([
  'MESSAGES_UPSERT',
  'SEND_MESSAGE',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
]);

function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function extractText(message: Record<string, unknown>): string {
  if (typeof message === 'string') return message as unknown as string;
  const m = message as Record<string, unknown>;
  return (
    (m.conversation as string) ||
    ((m.extendedTextMessage as Record<string, string> | undefined)?.text ?? '') ||
    ((m.imageMessage as Record<string, string> | undefined)?.caption ?? '') ||
    ((m.videoMessage as Record<string, string> | undefined)?.caption ?? '') ||
    ((m.documentMessage as Record<string, string> | undefined)?.caption ?? '') ||
    ((m.message as Record<string, string> | undefined)?.conversation ?? '') ||
    ''
  );
}

function extractMediaType(message: Record<string, unknown>): string {
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  return 'text';
}

function extractCaption(message: Record<string, unknown>): string {
  return (
    ((message.imageMessage as Record<string, string> | undefined)?.caption ?? '') ||
    ((message.videoMessage as Record<string, string> | undefined)?.caption ?? '') ||
    ((message.documentMessage as Record<string, string> | undefined)?.caption ?? '')
  );
}

function isSendPendingStatus(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'number' && raw === 0) return true;
  if (typeof raw === 'string') return raw.trim().toUpperCase() === 'PENDING';
  return false;
}

function pickSendWebhookStatus(data: Record<string, unknown>): unknown {
  if (!data || typeof data !== 'object') return undefined;
  return data.status ?? (data as Record<string, Record<string, unknown>>).messageStatus ?? (data as Record<string, Record<string, unknown>>).message?.status ?? (data as Record<string, Record<string, Record<string, unknown>>>).message?.message?.status;
}

async function handleMessageUpsert(
  instance: { id: string; workspace_id: string | null; user_id: string | null },
  data: Record<string, unknown>,
  fromMe: boolean
) {
  const message = (data.message || data) as Record<string, unknown>;
  const key = ((message.key || data.key || {}) as Record<string, unknown>);
  const remoteJid = (key.remoteJid || data.remoteJid) as string | undefined;

  if (!remoteJid) return;

  const conversationData = {
    instance_id: instance.id,
    workspace_id: instance.workspace_id ?? undefined,
    user_id: instance.user_id ?? undefined,
    remote_jid: remoteJid,
    title: String(data.pushName ?? remoteJid.split('@')[0]),
    is_group: remoteJid.endsWith('@g.us'),
    last_message_at: new Date().toISOString(),
    last_message_preview: extractText(message).substring(0, 100),
  };

  const conversation = await chatService.upsertConversation(conversationData);

  const messageFromMe = (key.fromMe as boolean | undefined) || fromMe;
  await chatService.saveMessage({
    instance_id: instance.id,
    workspace_id: instance.workspace_id ?? undefined,
    user_id: instance.user_id ?? undefined,
    conversation_id: conversation.id,
    message_id: String(key.id ?? data.id ?? data.messageId ?? ''),
    direction: messageFromMe ? 'out' : 'in',
    from_me: messageFromMe,
    sender_jid: String(key.participant ?? key.remoteJid ?? data.sender ?? remoteJid),
    text: extractText(message),
    media_type: extractMediaType(message),
    media_url: undefined,
    caption: extractCaption(message),
    status: messageFromMe ? 'sent' : 'received',
    timestamp: Number(data.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  });

  if (!messageFromMe) {
    try {
      await supabaseServiceRole.rpc('increment_unread_count', { conv_id: conversation.id });
    } catch {
      await supabaseServiceRole
        .from('chat_conversations')
        .update({ unread_count: ((conversation as Record<string, unknown>).unread_count as number || 0) + 1 })
        .eq('id', conversation.id);
    }
  }
}

async function handleSendMessageWebhook(
  instance: { id: string; workspace_id: string | null; user_id: string | null },
  data: Record<string, unknown>
) {
  const message = (data.message ?? data) as Record<string, unknown>;
  const key = ((message.key || data.key || {}) as Record<string, unknown>);
  const messageId = key.id as string | undefined;
  const sendStatus = pickSendWebhookStatus(data) ?? pickSendWebhookStatus(message);

  if (messageId && isSendPendingStatus(sendStatus)) {
    const { data: updatedRows, error } = await supabaseServiceRole
      .from('chat_messages')
      .update({ status: 'sent' })
      .eq('instance_id', instance.id)
      .eq('message_id', messageId)
      .eq('status', 'pending')
      .select('id');

    if (!error && updatedRows && updatedRows.length > 0) return;
  }

  await handleMessageUpsert(instance, data, true);
}

async function handleMessageUpdate(
  instance: { id: string },
  data: Record<string, unknown>
) {
  const key = (data.key || {}) as Record<string, unknown>;
  if (!key.id) return;

  const statusMap: Record<number, string> = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played' };
  const newStatus = statusMap[data.status as number] || 'updated';

  await supabaseServiceRole
    .from('chat_messages')
    .update({ status: newStatus })
    .eq('instance_id', instance.id)
    .eq('message_id', key.id);
}

async function handleMessageDelete(
  instance: { id: string },
  data: Record<string, unknown>
) {
  const key = (data.key || {}) as Record<string, unknown>;
  if (!key.id) return;

  await supabaseServiceRole
    .from('chat_messages')
    .delete()
    .eq('instance_id', instance.id)
    .eq('message_id', key.id);
}

/**
 * Processa um payload da tabela evolution_webhook_events nas tabelas de chat.
 * Retorna `{ processed, skipped }`.
 *   - skipped = true quando o evento não é relevante para o chat (CONNECTION_UPDATE, etc.)
 */
export async function processEvolutionPayloadToChat(
  payload: unknown
): Promise<{ processed: boolean; skipped: boolean }> {
  if (!payload || typeof payload !== 'object') return { processed: false, skipped: true };

  const p = payload as Record<string, unknown>;

  const rawEvent = pickFirstString(p.event, p.eventType, p.event_type, p.type, (p.data as Record<string, unknown>)?.event);
  const event = rawEvent ? normalizeEvolutionChatWebhookEvent(rawEvent) : '';
  const instanceName = extractEvolutionWebhookInstanceName(payload);
  const data = (p.data ?? p) as Record<string, unknown>;

  if (!event || !instanceName) return { processed: false, skipped: true };
  if (!CHAT_EVENT_TYPES.has(event)) return { processed: false, skipped: true };

  const { data: dbInstance, error: instError } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, workspace_id, user_id')
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle();

  if (instError || !dbInstance) return { processed: false, skipped: true };

  switch (event) {
    case 'MESSAGES_UPSERT':
      await handleMessageUpsert(dbInstance, data, false);
      break;
    case 'SEND_MESSAGE':
      await handleSendMessageWebhook(dbInstance, data);
      break;
    case 'MESSAGES_UPDATE':
      await handleMessageUpdate(dbInstance, data);
      break;
    case 'MESSAGES_DELETE':
      await handleMessageDelete(dbInstance, data);
      break;
  }

  return { processed: true, skipped: false };
}
