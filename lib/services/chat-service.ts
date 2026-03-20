/*
 * CHAT SERVICE
 *
 * Serviço de gerenciamento de chat integrado com Evolution API e WhatsApp Oficial.
 * saveMessage() é o ponto único de persistência: normaliza timestamp, deduplica
 * via ignoreDuplicates e atualiza o resumo da conversa após cada inserção.
 */

export interface ChatMessage {
  id?: string;
  workspace_id?: string;
  user_id?: string;
  instance_id?: string | null;
  whatsapp_config_id?: string | null;
  conversation_id?: string;
  message_id: string;
  direction: 'in' | 'out';
  from_me: boolean;
  sender_jid: string;
  text?: string;
  media_type?: string;
  media_url?: string;
  caption?: string;
  status?: string;
  timestamp: number;
  created_at?: string;
  provider?: 'evolution' | 'whatsapp_official';
}

export interface ChatConversation {
  id?: string;
  workspace_id?: string;
  user_id?: string;
  instance_id?: string | null;
  whatsapp_config_id?: string | null;
  remote_jid: string;
  title?: string;
  profile_pic_url?: string | null;
  is_group: boolean;
  last_message_at?: string;
  last_message_preview?: string;
  /** Última mensagem recebida do contato (WhatsApp Oficial). Usado para janela de 24h. */
  last_customer_message_at?: string | null;
  unread_count?: number;
}

import { supabaseServiceRole } from './supabase-service';

function toTimestampNumber(ts: number | string | null | undefined): number {
  if (!ts) return Math.floor(Date.now() / 1000);
  return typeof ts === 'string' ? parseInt(ts, 10) : ts;
}

export class ChatService {
  async sendMessage(
    instance: { instance_name: string; apikey: string; base_url: string },
    payload: {
      remoteJid: string;
      type: 'text' | 'media';
      text?: string;
      media?: string;
      mimetype?: string;
      mediatype?: string;
      caption?: string;
      fileName?: string;
    }
  ) {
    const { instance_name, apikey, base_url } = instance;
    const baseUrl = base_url.replace(/\/+$/, '');
    const outboundNumber = payload.remoteJid.endsWith('@s.whatsapp.net')
      ? payload.remoteJid.replace(/@s\.whatsapp\.net$/i, '')
      : payload.remoteJid;

    let endpoint = '';
    let body: Record<string, unknown> = { number: outboundNumber };

    if (payload.type === 'text') {
      endpoint = `${baseUrl}/message/sendText/${instance_name}`;
      body.text = payload.text;
    } else {
      endpoint = `${baseUrl}/message/sendMedia/${instance_name}`;
      body = {
        ...body,
        media: payload.media,
        mediatype: payload.mediatype,
        mimetype: payload.mimetype,
        caption: payload.caption,
        fileName: payload.fileName,
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao enviar mensagem: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  normalizeEvolutionEvent(
    instance_id: string,
    workspace_id: string | null,
    event: string,
    payload: Record<string, unknown>
  ) {
    const data = (payload.data as Record<string, unknown>) || payload;
    const message = (data.message as Record<string, unknown>) || data;
    const key = (message.key as Record<string, unknown>) || {};

    return {
      instance_id,
      workspace_id,
      message_id: (key.id as string) || (data.id as string) || (data.messageId as string),
      remote_jid: (key.remoteJid as string) || (data.remoteJid as string),
      from_me: (key.fromMe as boolean) || false,
      sender_jid:
        (key.participant as string) || (key.remoteJid as string) || (data.sender as string),
      text:
        (message.conversation as string) ||
        ((message.extendedTextMessage as Record<string, unknown>)?.text as string) ||
        ((message.imageMessage as Record<string, unknown>)?.caption as string) ||
        ((message.videoMessage as Record<string, unknown>)?.caption as string) ||
        '',
      media_type: message.imageMessage
        ? 'image'
        : message.videoMessage
        ? 'video'
        : message.audioMessage
        ? 'audio'
        : message.documentMessage
        ? 'document'
        : 'text',
      media_url: null as string | null,
      caption:
        ((message.imageMessage as Record<string, unknown>)?.caption as string) ||
        ((message.videoMessage as Record<string, unknown>)?.caption as string) ||
        '',
      timestamp: toTimestampNumber(data.messageTimestamp as number | string),
      status: 'received',
    };
  }

  async upsertConversation(conversation: ChatConversation) {
    // conflict_key é coluna gerada (i-{instance_id} ou w-{whatsapp_config_id}); evita índices parciais no ON CONFLICT
    const { data, error } = await supabaseServiceRole
      .from('chat_conversations')
      .upsert(conversation, { onConflict: 'conflict_key,remote_jid' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Persiste uma mensagem com deduplicação automática (ignoreDuplicates).
   * Após inserção bem-sucedida, atualiza last_message_preview, last_message_at
   * e, se direction='in', last_customer_message_at na conversa.
   * Retorna null quando a mensagem já existia (duplicata ignorada).
   */
  async saveMessage(message: ChatMessage): Promise<ChatMessage | null> {
    const normalized: ChatMessage = {
      ...message,
      timestamp: toTimestampNumber(message.timestamp as number | string),
    };

    const { data: msg, error } = await supabaseServiceRole
      .from('chat_messages')
      .upsert(normalized, {
        onConflict: 'conversation_id,message_id',
        ignoreDuplicates: true,
      })
      .select()
      .single();

    // PGRST116 = no rows returned (ignoreDuplicates suprimiu o INSERT)
    // 23505 = unique_violation (fallback de segurança)
    if (error?.code === 'PGRST116' || error?.code === '23505') {
      console.debug(`[Zaploto Chat] saveMessage: duplicata ignorada (${normalized.message_id})`);
      return null;
    }
    if (error) throw error;
    if (!msg) return null;

    // Atualizar campos de resumo na conversa pai
    if (normalized.conversation_id) {
      const tsMs = normalized.timestamp > 0 ? normalized.timestamp * 1000 : Date.now();
      const lastMessageAt = new Date(tsMs).toISOString();
      const lastPreview =
        normalized.text?.slice(0, 100) ||
        (normalized.media_type && normalized.media_type !== 'text' ? normalized.media_type : '') ||
        '';

      const updateFields: Record<string, unknown> = {
        last_message_at: lastMessageAt,
        last_message_preview: lastPreview,
      };

      if (normalized.direction === 'in') {
        updateFields.last_customer_message_at = lastMessageAt;
      }

      await supabaseServiceRole
        .from('chat_conversations')
        .update(updateFields)
        .eq('id', normalized.conversation_id);
    }

    return msg as ChatMessage;
  }
}

export const chatService = new ChatService();
