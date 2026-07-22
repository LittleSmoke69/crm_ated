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
  provider_media_id?: string;
  media_mime_type?: string;
  media_filename?: string;
  media_recovery_status?: 'pending' | 'ready' | 'failed';
  media_recovery_attempts?: number;
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
import { coerceEvolutionSendMediaFields } from '@/lib/crm/evolution-send-media-meta';

const SAVE_MESSAGE_MAX_RETRIES = 4;
const SAVE_MESSAGE_BASE_DELAY_MS = 400;
const CONVERSATION_UPDATE_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Erros de rede / indisponibilidade temporária do PostgREST (undici, CF, etc.). */
function isTransientSupabaseOrNetworkError(err: unknown): boolean {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; depth < 10 && e != null; depth += 1) {
    if (typeof e === 'object' && e !== null) {
      const o = e as Record<string, unknown>;
      if (typeof o.message === 'string') parts.push(o.message);
      if (o.code != null) parts.push(String(o.code));
      if (typeof o.details === 'string') parts.push(o.details);
      e = o.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  const text = parts.join(' ').toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('bad gateway') ||
    text.includes('service unavailable') ||
    text.includes('gateway timeout') ||
    text.includes('cloudflare') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504') ||
    text.includes('525') ||
    text.includes('connect timeout') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('connection terminated')
  );
}

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
    let fallbackEndpoint: string | null = null;

    if (payload.type === 'text') {
      endpoint = `${baseUrl}/message/sendText/${instance_name}`;
      body.text = payload.text;
    } else if (payload.mediatype === 'audio') {
      // Endpoint oficial mais recente da Evolution para áudio
      endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instance_name}`;
      // Compatibilidade com versões/instalações antigas
      fallbackEndpoint = `${baseUrl}/message/sendAudio/${instance_name}`;
      body = {
        ...body,
        audio: payload.media,
      };
    } else {
      const coerced = coerceEvolutionSendMediaFields({
        mediatype: payload.mediatype,
        mimetype: payload.mimetype,
        fileName: payload.fileName,
        mediaUrl: payload.media,
      });
      endpoint = `${baseUrl}/message/sendMedia/${instance_name}`;
      body = {
        ...body,
        media: payload.media,
        mediatype: coerced.mediatype,
        mimetype: coerced.mimetype,
        caption: payload.caption,
        fileName: coerced.fileName,
      };
    }

    const doRequest = async (url: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey },
        body: JSON.stringify(body),
      });

    let response = await doRequest(endpoint);
    if (!response.ok && fallbackEndpoint && (response.status === 404 || response.status === 405)) {
      response = await doRequest(fallbackEndpoint);
    }

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
    for (let attempt = 1; attempt <= SAVE_MESSAGE_MAX_RETRIES; attempt += 1) {
      const { data, error } = await supabaseServiceRole
        .from('chat_conversations')
        .upsert(conversation, { onConflict: 'conflict_key,remote_jid' })
        .select()
        .single();

      if (!error && data) return data;

      const transient = error != null && isTransientSupabaseOrNetworkError(error);
      if (transient && attempt < SAVE_MESSAGE_MAX_RETRIES) {
        const jitterMs = Math.floor(Math.random() * 120);
        await sleep(SAVE_MESSAGE_BASE_DELAY_MS * 2 ** (attempt - 1) + jitterMs);
        continue;
      }

      if (error) throw error;
    }
    throw new Error('upsertConversation: falha após retentativas');
  }

  /**
   * Persiste mensagem com upsert em (conversation_id, message_id).
   * Usa ON CONFLICT DO UPDATE para que envios pela API (ex.: WhatsApp Oficial) sobrescrevam
   * linhas criadas antes pelo webhook com o mesmo wamid (status received/pending → sent).
   * Retorna null só em casos excepcionais (ex.: PGRST116 / violação de unicidade legada).
   */
  async saveMessage(message: ChatMessage): Promise<ChatMessage | null> {
    const normalized: ChatMessage = {
      ...message,
      timestamp: toTimestampNumber(message.timestamp as number | string),
    };

    // Webhook `failed` pode chegar antes do save do send; não sobrescrever erro da Meta com "sent"/"Nota de voz".
    if (normalized.conversation_id && normalized.message_id) {
      const { data: existing } = await supabaseServiceRole
        .from('chat_messages')
        .select('status, text')
        .eq('conversation_id', normalized.conversation_id)
        .eq('message_id', normalized.message_id)
        .maybeSingle();

      if (existing?.status === 'failed') {
        normalized.status = 'failed';
        const existingText = String(existing.text ?? '');
        const isDeliveryError =
          existingText.includes('Falha na entrega') ||
          existingText.includes('Entrega falhou') ||
          /^#\d+/.test(existingText);
        if (isDeliveryError) {
          normalized.text = existingText;
        }
      }
    }

    let msg: ChatMessage | null = null;

    for (let attempt = 1; attempt <= SAVE_MESSAGE_MAX_RETRIES; attempt += 1) {
      const { data: row, error } = await supabaseServiceRole
        .from('chat_messages')
        .upsert(normalized, {
          onConflict: 'conversation_id,message_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      // PGRST116 = nenhuma linha retornada (raro com upsert update)
      // 23505 = unique_violation em outro índice (fallback)
      if (error?.code === 'PGRST116' || error?.code === '23505') {
        return null;
      }

      if (!error && row) {
        msg = row as ChatMessage;
        break;
      }

      const transient = error != null && isTransientSupabaseOrNetworkError(error);
      if (transient && attempt < SAVE_MESSAGE_MAX_RETRIES) {
        // First retry is immediate to avoid unnecessary latency on transient blips
        if (attempt > 1) {
          const jitterMs = Math.floor(Math.random() * 120);
          const delayMs = SAVE_MESSAGE_BASE_DELAY_MS * 2 ** (attempt - 2) + jitterMs;
          console.warn(
            `[Zaploto Chat] saveMessage: falha transitória (tentativa ${attempt}/${SAVE_MESSAGE_MAX_RETRIES}), nova tentativa em ${delayMs}ms`,
            error instanceof Error ? error.message : error
          );
          await sleep(delayMs);
        } else {
          console.warn(
            `[Zaploto Chat] saveMessage: falha transitória (tentativa ${attempt}/${SAVE_MESSAGE_MAX_RETRIES}), nova tentativa imediata`,
            error instanceof Error ? error.message : error
          );
        }
        continue;
      }

      if (error) throw error;
      return null;
    }

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
        // Cliente respondeu: reabre a conversa mesmo se estava marcada como resolvida.
        updateFields.attendance_status = 'pendente';
        updateFields.resolved_at = null;
      }

      for (let attempt = 1; attempt <= CONVERSATION_UPDATE_MAX_RETRIES; attempt += 1) {
        const { error: updErr } = await supabaseServiceRole
          .from('chat_conversations')
          .update(updateFields)
          .eq('id', normalized.conversation_id);

        if (!updErr) break;

        const transient = isTransientSupabaseOrNetworkError(updErr);
        if (transient && attempt < CONVERSATION_UPDATE_MAX_RETRIES) {
          // First retry is immediate; subsequent retries use exponential backoff
          if (attempt > 1) {
            const jitterMs = Math.floor(Math.random() * 80);
            await sleep(SAVE_MESSAGE_BASE_DELAY_MS * (attempt - 1) + jitterMs);
          }
          continue;
        }
        throw updErr;
      }

      // Fecha (best-effort) o ciclo de resolução aberto, se o cliente respondeu uma conversa resolvida.
      // Não afeta nada se não houver ciclo aberto (conversa já estava pendente).
      if (normalized.direction === 'in') {
        const { error: reopenHistoryError } = await supabaseServiceRole
          .from('chat_conversation_resolutions')
          .update({
            reopened_at: new Date().toISOString(),
            reopened_reason: 'customer_reply',
          })
          .eq('conversation_id', normalized.conversation_id)
          .is('reopened_at', null);
        if (reopenHistoryError) {
          console.error(
            '[Zaploto Chat] resolution history close (customer reply) — erro:',
            reopenHistoryError.message
          );
        }
      }
    }

    return msg as ChatMessage;
  }
}

export const chatService = new ChatService();
