/* 
 * CHAT SERVICE - REATIVADO
 * 
 * Serviço de gerenciamento de chat integrado com webhooks da Evolution API.
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
  is_group: boolean;
  last_message_at?: string;
  last_message_preview?: string;
  unread_count?: number;
}

import { supabaseServiceRole } from './supabase-service';

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
    
    let endpoint = '';
    let body: any = {
      number: payload.remoteJid,
    };

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
      headers: {
        'Content-Type': 'application/json',
        apikey: apikey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao enviar mensagem: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  normalizeEvolutionEvent(instance_id: string, workspace_id: string | null, event: string, payload: any) {
    const data = payload.data || payload;
    const message = data.message || data;
    const key = message.key || {};
    
    const normalized = {
      instance_id,
      workspace_id,
      message_id: key.id || data.id || data.messageId,
      remote_jid: key.remoteJid || data.remoteJid,
      from_me: key.fromMe || false,
      sender_jid: key.participant || key.remoteJid || data.sender,
      text: message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '',
      media_type: message.imageMessage ? 'image' : message.videoMessage ? 'video' : message.audioMessage ? 'audio' : message.documentMessage ? 'document' : 'text',
      media_url: null as string | null,
      caption: message.imageMessage?.caption || message.videoMessage?.caption || '',
      timestamp: data.messageTimestamp || Math.floor(Date.now() / 1000),
      status: 'received',
    };

    return normalized;
  }

  async upsertConversation(conversation: ChatConversation) {
    const conflict = conversation.whatsapp_config_id
      ? 'whatsapp_config_id,remote_jid'
      : 'instance_id,remote_jid';
    const { data, error } = await supabaseServiceRole
      .from('chat_conversations')
      .upsert(conversation, { onConflict: conflict })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async saveMessage(message: ChatMessage) {
    const { data, error } = await supabaseServiceRole
      .from('chat_messages')
      .upsert(message, {
        onConflict: 'conversation_id,message_id',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export const chatService = new ChatService();
