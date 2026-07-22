/**
 * POST /api/chat/whatsapp-official/send
 * Envia mensagem (texto, imagem ou áudio) via WhatsApp Cloud API e persiste no chat interno.
 */

import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import * as whatsappOfficial from '@/lib/services/whatsapp-official-service';
import { reconcileOfficialOutboundStatus } from '@/lib/services/whatsapp-official-webhook-processor';
import {
  extensionForWhatsAppMedia,
  storageContentTypeForWhatsAppMedia,
} from '@/lib/services/whatsapp-official-media-mime';
import { sanitizeMediaError } from '@/lib/chat/sanitize-media-error';

const CHAT_MEDIA_BUCKET = 'chat-media';

async function resolveMetaMediaInBackground(
  metaId: string,
  accessToken: string,
  graphVersion: string,
  configId: string,
  chatMessageId: string,
) {
  try {
    const version = graphVersion.replace(/^v/, '');
    const metaRes = await fetch(`https://graph.facebook.com/v${version}/${metaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) return;
    const { url: tempUrl, mime_type } = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!tempUrl) return;
    const downloadRes = await fetch(tempUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!downloadRes.ok) return;
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    const ext = extensionForWhatsAppMedia(mime_type, 'audio');
    const contentType = storageContentTypeForWhatsAppMedia(mime_type, ext, 'audio');
    const storagePath = `${configId}/${metaId}${ext}`;
    const { error } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true });
    if (error) return;
    const { data } = supabaseServiceRole.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(storagePath);
    await supabaseServiceRole
      .from('chat_messages')
      .update({ media_url: data.publicUrl })
      .eq('id', chatMessageId);
  } catch {
    // background — falha silenciosa; o retry manual do frontend pode resolver depois
  }
}

type SendType = 'text' | 'image' | 'audio' | 'video' | 'document';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const {
      config_id,
      to,
      type,
      text: bodyText,
      media_url,
      meta_id,
      media_mime_type,
      caption,
      filename,
      reply_to_message_id: replyToMessageId,
    } = body as {
      config_id?: string;
      to?: string;
      type?: string;
      text?: string;
      media_url?: string;
      meta_id?: string;
      media_mime_type?: string;
      caption?: string;
      filename?: string;
      reply_to_message_id?: string;
    };

    if (!config_id || !to || !type) {
      return errorResponse('config_id, to e type são obrigatórios', 400);
    }

    const sendType = type as SendType;
    if (!['text', 'image', 'audio', 'video', 'document'].includes(sendType)) {
      return errorResponse('type deve ser text, image, audio, video ou document', 400);
    }

    if (sendType === 'text' && (bodyText == null || String(bodyText).trim() === '')) {
      return errorResponse('text é obrigatório quando type=text', 400);
    }
    if (sendType === 'audio' && !meta_id && (!media_url || typeof media_url !== 'string')) {
      return errorResponse(
        'Áudio requer media_id (upload-audio-meta) ou media_url pública após upload-media.',
        400
      );
    }
    if (
      (sendType === 'image' || sendType === 'video' || sendType === 'document') &&
      !meta_id &&
      (!media_url || typeof media_url !== 'string')
    ) {
      return errorResponse('meta_id ou media_url é obrigatório para tipo de mídia', 400);
    }
    const normalizedMime = String(media_mime_type || '').split(';')[0].trim().toLowerCase();
    if (normalizedMime) {
      const incompatible =
        (sendType === 'image' && !normalizedMime.startsWith('image/')) ||
        (sendType === 'video' && normalizedMime !== 'video/mp4') ||
        (sendType === 'audio' && !normalizedMime.startsWith('audio/'));
      if (incompatible) {
        return errorResponse('O tipo selecionado não corresponde ao conteúdo do arquivo.', 400);
      }
    }

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, phone_number_id, waba_id, graph_version, access_token, zaploto_id')
      .eq('id', config_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return errorResponse('Configuração não encontrada ou inativa', 404);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = String(profile?.status || '').toLowerCase();
    const isAdminOrSuporte = status === 'super_admin' || status === 'admin' || status === 'suporte';
    if (!isAdminOrSuporte && profile?.zaploto_id !== config.zaploto_id) {
      return errorResponse('Acesso negado a esta configuração', 403);
    }

    const normalizedTo = to.replace(/\D/g, '');
    const remoteJid = `${normalizedTo}@s.whatsapp.net`;

    // Janela de 24h (WhatsApp Oficial): mensagem livre só dentro de 24h da última mensagem do contato
    const { data: existingConversation } = await supabaseServiceRole
      .from('chat_conversations')
      .select('id, last_customer_message_at')
      .eq('whatsapp_config_id', config_id)
      .eq('remote_jid', remoteJid)
      .maybeSingle();

    const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
    const lastCustomerAt = existingConversation?.last_customer_message_at
      ? new Date(existingConversation.last_customer_message_at).getTime()
      : null;
    const isWithin24h = lastCustomerAt != null && Date.now() - lastCustomerAt < WINDOW_24H_MS;

    if (!isWithin24h) {
      return errorResponse(
        'Fora da janela de 24h: o contato não enviou mensagem nas últimas 24 horas. Use mensagem template para iniciar ou reabrir a conversa.',
        400
      );
    }
    const configForApi = {
      id: config.id,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id,
      graph_version: config.graph_version,
      access_token: config.access_token,
    };

    let metaResponse: { messages: Array<{ id: string }> };
    try {
      if (sendType === 'text') {
        metaResponse = await whatsappOfficial.sendText(
          configForApi,
          normalizedTo,
          String(bodyText).trim(),
          replyToMessageId
        );
      } else if (sendType === 'image') {
        metaResponse = await whatsappOfficial.sendImage(
          configForApi,
          normalizedTo,
          meta_id ? { id: String(meta_id) } : { link: media_url! },
          caption,
          replyToMessageId
        );
      } else if (sendType === 'video') {
        metaResponse = await whatsappOfficial.sendVideo(
          configForApi,
          normalizedTo,
          meta_id ? { id: String(meta_id) } : { link: media_url! },
          caption,
          replyToMessageId
        );
      } else if (sendType === 'document') {
        const docFilename =
          (typeof filename === 'string' && filename.trim()) ||
          (typeof caption === 'string' && caption.includes('.') ? caption.trim() : undefined) ||
          (() => {
            try {
              if (!media_url) return undefined;
              const part = new URL(media_url!).pathname.split('/').pop() || '';
              const decoded = decodeURIComponent(part.replace(/^\d+-/, ''));
              return decoded.includes('.') ? decoded : undefined;
            } catch {
              return undefined;
            }
          })();
        metaResponse = await whatsappOfficial.sendDocument(
          configForApi,
          normalizedTo,
          meta_id ? { id: String(meta_id) } : { link: media_url! },
          caption,
          docFilename,
          replyToMessageId
        );
      } else {
        const audioMedia =
          meta_id && String(meta_id).trim()
            ? { id: String(meta_id).trim(), voice: true as const }
            : { link: media_url! };
        console.info('[WA Official][send route] audio send mode', {
          config_id,
          recipient_suffix: normalizedTo.slice(-4),
          mode: 'id' in audioMedia ? 'media_id_voice' : 'link',
          has_reply_to: Boolean(replyToMessageId),
        });
        metaResponse = await whatsappOfficial.sendAudio(
          configForApi,
          normalizedTo,
          audioMedia,
          replyToMessageId
        );
      }
    } catch (err: unknown) {
      const e = err as Error & { name?: string };
      console.error('[WA Official][send route] send error', {
        config_id,
        recipient_suffix: normalizedTo.slice(-4),
        type: sendType,
        error_name: e?.name,
        error_message: e?.message,
      });
      if (e?.name === 'AbortError') {
        return errorResponse('Timeout ao enviar mensagem para a API do WhatsApp', 502);
      }
      return errorResponse(sanitizeMediaError(e, 'Falha ao enviar mensagem'), 502);
    }

    const externalMessageId = metaResponse.messages[0].id;

    const conversationData = {
      whatsapp_config_id: config.id,
      instance_id: null,
      workspace_id: profile?.zaploto_id ?? null,
      user_id: userId,
      remote_jid: remoteJid,
      title: normalizedTo,
      is_group: false,
      last_message_at: new Date().toISOString(),
      last_message_preview: sendType === 'text' ? (bodyText || '').slice(0, 100) : sendType === 'image' ? `Imagem${caption ? `: ${caption}` : ''}` : sendType === 'video' ? `Vídeo${caption ? `: ${caption}` : ''}` : sendType === 'document' ? `Documento${caption ? `: ${caption}` : ''}` : 'Áudio',
    };

    const conversation = await chatService.upsertConversation(conversationData);

    const resolvedMediaUrl = sendType !== 'text' ? (media_url || undefined) : undefined;

    const messageData = {
      instance_id: null,
      whatsapp_config_id: config.id,
      workspace_id: conversationData.workspace_id,
      user_id: userId,
      conversation_id: conversation.id,
      message_id: externalMessageId,
      direction: 'out' as const,
      from_me: true,
      sender_jid: config.phone_number_id,
      text:
        sendType === 'text'
          ? String(bodyText).trim()
          : sendType === 'audio'
            ? 'Nota de voz'
            : '',
      media_type: sendType === 'text' ? 'text' : sendType,
      media_url: resolvedMediaUrl,
      provider_media_id: meta_id || undefined,
      media_mime_type: media_mime_type || undefined,
      media_filename: typeof filename === 'string' ? filename.trim() || undefined : undefined,
      media_recovery_status: sendType === 'text' ? undefined : resolvedMediaUrl ? 'ready' as const : 'pending' as const,
      caption:
        sendType === 'document'
          ? (typeof filename === 'string' && filename.trim()) ||
            caption ||
            (() => {
              try {
                const part = new URL(media_url || '').pathname.split('/').pop() || '';
                return decodeURIComponent(part.replace(/^\d+-/, '')) || '';
              } catch {
                return '';
              }
            })()
          : sendType === 'image' || sendType === 'video'
            ? caption || ''
            : '',
      status: 'sent',
      timestamp: Math.floor(Date.now() / 1000),
      provider: 'whatsapp_official' as const,
    };

    const savedMessage = await chatService.saveMessage(messageData);

    after(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      await reconcileOfficialOutboundStatus(externalMessageId).catch((err) => {
        console.warn('[WA Official][send route] reconcile status failed', {
          message_id: externalMessageId,
          error: err instanceof Error ? err.message : err,
        });
      });
    });

    const savedId = savedMessage?.id;
    if (sendType === 'audio' && !resolvedMediaUrl && meta_id && savedId) {
      after(() =>
        resolveMetaMediaInBackground(
          meta_id,
          config.access_token,
          config.graph_version || 'v25.0',
          config.id,
          savedId,
        )
      );
    }

    return successResponse(
      {
        external_message_id: externalMessageId,
        message: savedMessage,
      },
      'Mensagem enviada com sucesso'
    );
  } catch (err: unknown) {
    return errorResponse(sanitizeMediaError(err, 'Falha inesperada ao enviar mensagem.'), 500);
  }
}
