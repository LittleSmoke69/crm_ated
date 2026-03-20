/**
 * POST /api/chat/whatsapp-official/send
 * Envia mensagem (texto, imagem ou áudio) via WhatsApp Cloud API e persiste no chat interno.
 */

import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import * as whatsappOfficial from '@/lib/services/whatsapp-official-service';

const CHAT_MEDIA_BUCKET = 'chat-media';
const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
  'audio/webm': '.webm', 'audio/aac': '.aac',
};

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
    const ext = MIME_TO_EXT[mime_type?.toLowerCase() ?? ''] || '.ogg';
    const storagePath = `${configId}/${metaId}${ext}`;
    const { error } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: mime_type || 'audio/ogg', upsert: true });
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
      caption,
      reply_to_message_id: replyToMessageId,
    } = body as {
      config_id?: string;
      to?: string;
      type?: string;
      text?: string;
      media_url?: string;
      meta_id?: string;
      caption?: string;
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
    // Para áudio: aceita meta_id (preferencial) ou media_url (fallback)
    if (sendType === 'audio' && !meta_id && !media_url) {
      return errorResponse('meta_id ou media_url é obrigatório para áudio', 400);
    }
    if ((sendType === 'image' || sendType === 'video' || sendType === 'document') && (!media_url || typeof media_url !== 'string')) {
      return errorResponse('media_url é obrigatório para tipo de mídia', 400);
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

    let metaResponse: { messages?: Array<{ id: string }> };
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
          media_url!,
          caption,
          replyToMessageId
        );
      } else if (sendType === 'video') {
        metaResponse = await whatsappOfficial.sendVideo(
          configForApi,
          normalizedTo,
          media_url!,
          caption,
          replyToMessageId
        );
      } else if (sendType === 'document') {
        metaResponse = await whatsappOfficial.sendDocument(
          configForApi,
          normalizedTo,
          media_url!,
          caption,
          undefined,
          replyToMessageId
        );
      } else {
        // meta_id = upload direto nos servidores da Meta (preferencial, garante entrega)
        // media_url = fallback via link público (pode falhar para audio/webm)
        const audioMedia = meta_id
          ? { id: meta_id }
          : { link: media_url! };
        metaResponse = await whatsappOfficial.sendAudio(
          configForApi,
          normalizedTo,
          audioMedia,
          replyToMessageId
        );
      }
    } catch (err: unknown) {
      const e = err as Error & { name?: string };
      if (e?.name === 'AbortError') {
        return errorResponse('Timeout ao enviar mensagem para a API do WhatsApp', 502);
      }
      return errorResponse(e?.message || 'Falha ao enviar mensagem', 502);
    }

    const externalMessageId = metaResponse?.messages?.[0]?.id || `wamid_${Date.now()}`;

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
      text: sendType === 'text' ? String(bodyText).trim() : '',
      media_type: sendType === 'text' ? 'text' : sendType,
      media_url: resolvedMediaUrl,
      caption: (sendType === 'image' || sendType === 'video' || sendType === 'document') ? caption || '' : '',
      status: 'sent',
      timestamp: Math.floor(Date.now() / 1000),
      provider: 'whatsapp_official' as const,
    };

    const savedMessage = await chatService.saveMessage(messageData);

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
    return serverErrorResponse(err as Error);
  }
}
