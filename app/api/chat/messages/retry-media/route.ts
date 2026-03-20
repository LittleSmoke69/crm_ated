/**
 * POST /api/chat/messages/retry-media
 * Re-tenta baixar a mídia de uma mensagem que foi salva sem media_url.
 * Busca o raw_payload original no webhook_events para extrair o media_id da Meta
 * e faz o download + upload para o Supabase Storage.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const CHAT_MEDIA_BUCKET = 'chat-media';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'application/pdf': '.pdf',
};

function getExtension(mimeType: string | undefined): string {
  if (!mimeType) return '.bin';
  return MIME_TO_EXT[mimeType.toLowerCase()] || '.bin';
}

interface WaMediaObj {
  id?: string;
  mime_type?: string;
}

function extractMediaIdFromPayload(rawPayload: unknown, targetMessageId: string): WaMediaObj | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const payload = rawPayload as { entry?: unknown[] };
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[] } })?.value;
      if (!value?.messages) continue;
      for (const msg of value.messages as Array<Record<string, unknown>>) {
        if (msg.id !== targetMessageId) continue;
        const type = msg.type as string;
        if (!['image', 'audio', 'video', 'document'].includes(type)) return null;
        const mediaObj = msg[type] as WaMediaObj | undefined;
        if (mediaObj?.id) return mediaObj;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const { chat_message_id } = body as { chat_message_id?: string };

    if (!chat_message_id) {
      return errorResponse('chat_message_id é obrigatório', 400);
    }

    const { data: chatMsg, error: msgErr } = await supabaseServiceRole
      .from('chat_messages')
      .select('id, message_id, media_type, media_url, whatsapp_config_id, conversation_id, provider')
      .eq('id', chat_message_id)
      .single();

    if (msgErr || !chatMsg) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    if (chatMsg.media_url) {
      return successResponse({ media_url: chatMsg.media_url }, 'Mídia já disponível');
    }

    if (chatMsg.provider !== 'whatsapp_official' || !chatMsg.whatsapp_config_id) {
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

    const wamid = chatMsg.message_id;

    const { data: webhookEvents } = await supabaseServiceRole
      .from('webhook_events')
      .select('raw_payload')
      .eq('source', 'whatsapp_official')
      .order('created_at', { ascending: false })
      .limit(200);

    let mediaObj: WaMediaObj | null = null;
    if (webhookEvents) {
      for (const evt of webhookEvents) {
        mediaObj = extractMediaIdFromPayload(evt.raw_payload, wamid);
        if (mediaObj) break;
      }
    }

    if (!mediaObj?.id) {
      return errorResponse(
        'Não foi possível encontrar o ID da mídia no histórico de eventos. A mídia pode ter expirado.',
        404
      );
    }

    const version = (config.graph_version || 'v25.0').replace(/^v/, '');
    const mediaApiUrl = `https://graph.facebook.com/v${version}/${mediaObj.id}`;
    const metaRes = await fetch(mediaApiUrl, {
      headers: { Authorization: `Bearer ${config.access_token}` },
    });

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

    const downloadRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${config.access_token}` },
    });
    if (!downloadRes.ok) {
      return errorResponse(`Falha ao baixar mídia: ${downloadRes.status}`, 502);
    }

    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    const contentType = metaJson.mime_type || mediaObj.mime_type || 'application/octet-stream';
    const ext = getExtension(metaJson.mime_type || mediaObj.mime_type);
    const storagePath = `${config.id}/${mediaObj.id}${ext}`;

    const { error: uploadError } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      return errorResponse(`Falha no upload: ${uploadError.message}`, 500);
    }

    const { data: urlData } = supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    await supabaseServiceRole
      .from('chat_messages')
      .update({ media_url: publicUrl })
      .eq('id', chat_message_id);

    return successResponse({ media_url: publicUrl }, 'Mídia recuperada com sucesso');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
