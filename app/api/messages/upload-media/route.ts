import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET_NAME = 'campaign-media';

// Função para gerar UUID simples
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * POST /api/messages/upload-media
 * Gera signed upload URL para fazer upload de mídia
 * 
 * Body:
 * {
 *   messageId: string (obrigatório)
 *   mediaType: 'image' | 'video' | 'audio' (obrigatório)
 *   mime: string (obrigatório)
 *   size: number (obrigatório)
 *   originalName: string (obrigatório)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    const { messageId, mediaType, mime, size, originalName } = body;

    // Validação dos campos obrigatórios
    if (!messageId || typeof messageId !== 'string') {
      return errorResponse('Campo "messageId" é obrigatório');
    }

    if (!mediaType || !['image', 'video', 'audio'].includes(mediaType)) {
      return errorResponse('Campo "mediaType" deve ser "image", "video" ou "audio"');
    }

    if (!mime || typeof mime !== 'string') {
      return errorResponse('Campo "mime" é obrigatório');
    }

    if (!size || typeof size !== 'number' || size <= 0) {
      return errorResponse('Campo "size" deve ser um número positivo');
    }

    if (!originalName || typeof originalName !== 'string') {
      return errorResponse('Campo "originalName" é obrigatório');
    }

    // Validação de tamanho de arquivo
    const MAX_SIZES = {
      image: 15 * 1024 * 1024, // 15MB
      video: 60 * 1024 * 1024, // 60MB
      audio: 15 * 1024 * 1024, // 15MB
    };

    if (size > MAX_SIZES[mediaType as keyof typeof MAX_SIZES]) {
      return errorResponse(
        `Arquivo muito grande. Tamanho máximo: ${MAX_SIZES[mediaType as keyof typeof MAX_SIZES] / 1024 / 1024}MB`
      );
    }

    // Validação de MIME type
    const validMimes = {
      image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
      video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
      audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
    };

    if (!validMimes[mediaType as keyof typeof validMimes].includes(mime.toLowerCase())) {
      return errorResponse(`MIME type "${mime}" não é válido para ${mediaType}`);
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

    // Gera UUID para o arquivo
    const fileUuid = generateUUID();
    
    // Extrai extensão do nome original ou do MIME type
    const getExtension = (name: string, mimeType: string): string => {
      const nameExt = name.split('.').pop()?.toLowerCase();
      if (nameExt && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg', 'mp3', 'wav'].includes(nameExt)) {
        return nameExt;
      }
      
      // Fallback: tenta extrair do MIME type
      const mimeMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/ogg': 'ogg',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/webm': 'webm',
      };
      
      return mimeMap[mimeType.toLowerCase()] || 'bin';
    };

    const extension = getExtension(originalName, mime);
    const fileName = `${fileUuid}.${extension}`;
    const storagePath = `messages/${userId}/${messageId}/${mediaType}/${fileName}`;

    // Gera signed upload URL
    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
      .storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(storagePath, {
        upsert: false,
      });

    if (signedUrlError || !signedUrlData) {
      console.error('[upload-media] Erro ao gerar signed upload URL:', signedUrlError);
      return serverErrorResponse('Erro ao gerar URL de upload assinada');
    }

    return successResponse({
      bucket: BUCKET_NAME,
      path: storagePath,
      token: signedUrlData.token,
      signedUrl: signedUrlData.signedUrl || signedUrlData.path,
      messageId,
    });
  } catch (err: any) {
    console.error('[upload-media] Erro inesperado:', err);
    return serverErrorResponse(err.message || 'Erro ao gerar URL de upload');
  }
}

