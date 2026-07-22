/**
 * POST /api/chat/messages/retry-media
 * Re-tenta baixar a mídia de uma mensagem que foi salva sem media_url.
 * Usa o provider_media_id persistido para reconsultar a Meta e faz o download + upload para o Supabase Storage.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  extensionForWhatsAppMedia,
  storageContentTypeForWhatsAppMedia,
} from '@/lib/services/whatsapp-official-media-mime';
import { getAccessibleChatMediaMessage } from '@/lib/services/chat-media-access';
import { sanitizeMediaError } from '@/lib/chat/sanitize-media-error';

const CHAT_MEDIA_BUCKET = 'chat-media';

interface WaMediaObj {
  id?: string;
  mime_type?: string;
  filename?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const { chat_message_id } = body as { chat_message_id?: string };

    if (!chat_message_id) {
      return errorResponse('chat_message_id é obrigatório', 400);
    }

    const access = await getAccessibleChatMediaMessage(userId, chat_message_id);
    if (!access.message) {
      return errorResponse(access.status === 403 ? 'Acesso negado' : 'Mensagem não encontrada', access.status ?? 404);
    }
    const chatMsg = access.message;

    if (chatMsg.media_url) {
      return successResponse({ media_url: chatMsg.media_url }, 'Mídia já disponível');
    }

    if (!chatMsg.whatsapp_config_id) {
      return errorResponse('Retry de mídia disponível apenas para mensagens do WhatsApp Oficial', 400);
    }

    const mediaType = chatMsg.media_type;
    if (!mediaType || !['image', 'audio', 'video', 'document'].includes(mediaType)) {
      return errorResponse('Mensagem não possui mídia para resolver', 400);
    }

    const { data: config } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, access_token, graph_version')
      .eq('id', chatMsg.whatsapp_config_id)
      .eq('is_active', true)
      .single();

    if (!config?.access_token) {
      return errorResponse('Configuração do WhatsApp Oficial não encontrada ou sem token', 404);
    }

    const attempts = Number(chatMsg.media_recovery_attempts || 0);
    if (attempts >= 3) {
      return errorResponse('Limite de tentativas atingido. Use uma nova mídia ou contate o suporte.', 409);
    }

    const mediaObj: WaMediaObj | null = chatMsg.provider_media_id
      ? {
          id: chatMsg.provider_media_id,
          mime_type: chatMsg.media_mime_type || undefined,
          filename: chatMsg.media_filename || undefined,
        }
      : null;

    if (!mediaObj?.id) {
      return errorResponse(
        'A mensagem não possui o identificador persistido da mídia. Eventos antigos precisam de backfill.',
        404
      );
    }

    await supabaseServiceRole
      .from('chat_messages')
      .update({
        media_recovery_status: 'pending',
        media_recovery_attempts: attempts + 1,
      })
      .eq('id', chat_message_id);

    const version = (config.graph_version || 'v25.0').replace(/^v/, '');
    const mediaApiUrl = `https://graph.facebook.com/v${version}/${mediaObj.id}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const metaRes = await fetch(mediaApiUrl, {
      headers: { Authorization: `Bearer ${config.access_token}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!metaRes.ok) {
      const status = metaRes.status;
      await metaRes.text();
      if (status === 401) {
        return errorResponse('Token de acesso inválido ou expirado. Renove em Admin > WhatsApp Oficial.', 401);
      }
      return errorResponse(`Meta API retornou ${status}. A mídia pode ter expirado (válida por ~14 dias).`, 502);
    }

    const metaJson = await metaRes.json() as { url?: string; mime_type?: string };
    if (!metaJson.url) {
      return errorResponse('Meta API não retornou URL de download', 502);
    }

    const downloadController = new AbortController();
    const downloadTimer = setTimeout(() => downloadController.abort(), 2 * 60_000);
    const downloadRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${config.access_token}` },
      signal: downloadController.signal,
    }).finally(() => clearTimeout(downloadTimer));
    if (!downloadRes.ok) {
      return errorResponse(`Falha ao baixar mídia: ${downloadRes.status}`, 502);
    }

    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    const mimeCombined = metaJson.mime_type || mediaObj.mime_type;
    const mediaCat = chatMsg.media_type as 'image' | 'audio' | 'video' | 'document';
    const fileNameHint =
      mediaCat === 'document'
        ? mediaObj.filename || (chatMsg.caption as string | null) || undefined
        : undefined;
    const ext = extensionForWhatsAppMedia(mimeCombined, mediaCat, fileNameHint);
    const contentType = storageContentTypeForWhatsAppMedia(mimeCombined, ext, mediaCat, fileNameHint);
    const storagePath = `${config.id}/${mediaObj.id}${ext}`;

    const { error: uploadError } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      return errorResponse(sanitizeMediaError(uploadError, 'Falha ao armazenar a mídia.'), 500);
    }

    const { data: publicUrlData } = supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);
    const storedUrl = publicUrlData.publicUrl;

    await supabaseServiceRole
      .from('chat_messages')
      .update({
        media_url: storedUrl,
        media_mime_type: mimeCombined || null,
        media_filename: mediaObj.filename || null,
        media_recovery_status: 'ready',
      })
      .eq('id', chat_message_id);

    return successResponse({ media_url: storedUrl }, 'Mídia recuperada com sucesso');
  } catch (err) {
    return errorResponse(sanitizeMediaError(err, 'Falha inesperada ao recuperar a mídia.'), 500);
  }
}
