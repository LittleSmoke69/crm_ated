import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/messages/update-media-url
 * Atualiza a mensagem com a URL da mídia após upload
 * 
 * Body:
 * {
 *   messageId: string (obrigatório)
 *   bucket: string (obrigatório)
 *   path: string (obrigatório)
 *   mime: string (obrigatório)
 *   size: number (obrigatório)
 *   mediaType: 'image' | 'video' | 'audio' (obrigatório)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    const { messageId, bucket, path, mime, size, mediaType } = body;

    // Validação dos campos obrigatórios
    if (!messageId || typeof messageId !== 'string') {
      return errorResponse('Campo "messageId" é obrigatório');
    }

    if (!bucket || typeof bucket !== 'string') {
      return errorResponse('Campo "bucket" é obrigatório');
    }

    if (!path || typeof path !== 'string') {
      return errorResponse('Campo "path" é obrigatório');
    }

    if (!mime || typeof mime !== 'string') {
      return errorResponse('Campo "mime" é obrigatório');
    }

    if (!size || typeof size !== 'number' || size <= 0) {
      return errorResponse('Campo "size" deve ser um número positivo');
    }

    if (!mediaType || !['image', 'video', 'audio'].includes(mediaType)) {
      return errorResponse('Campo "mediaType" deve ser "image", "video" ou "audio"');
    }

    // Verifica se a mensagem existe e pertence ao usuário
    const { data: message, error: messageError } = await supabaseServiceRole
      .from('messages')
      .select('id, user_id')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    if (message.user_id !== userId) {
      return errorResponse('Acesso negado. Você não é o dono desta mensagem.', 403);
    }

    // Gera signed URL para leitura (válida por 1 ano)
    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
      .storage
      .from(bucket)
      .createSignedUrl(path, 31536000); // 1 ano

    if (signedUrlError || !signedUrlData) {
      console.error('[update-media-url] Erro ao gerar signed URL:', signedUrlError);
      return serverErrorResponse('Erro ao gerar URL assinada para a mídia');
    }

    // Atualiza a mensagem com os dados da mídia
    const updateData: any = {
      has_attachment: true,
      attachment_url: signedUrlData.signedUrl,
      attachment_type: mediaType,
      attachment_mime: mime,
      attachment_size: size,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedMessage, error: updateError } = await supabaseServiceRole
      .from('messages')
      .update(updateData)
      .eq('id', messageId)
      .select()
      .single();

    if (updateError || !updatedMessage) {
      console.error('[update-media-url] Erro ao atualizar mensagem:', updateError);
      return serverErrorResponse('Erro ao atualizar mensagem com URL da mídia');
    }

    return successResponse({
      message: updatedMessage,
      signedUrl: signedUrlData.signedUrl,
    });
  } catch (err: any) {
    console.error('[update-media-url] Erro inesperado:', err);
    return serverErrorResponse(err.message || 'Erro ao atualizar URL da mídia');
  }
}

