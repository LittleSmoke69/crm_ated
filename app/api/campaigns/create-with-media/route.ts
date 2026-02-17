import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET_NAME = 'campaign-media';

// Função para gerar UUID simples (fallback se não tiver biblioteca)
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * POST /api/campaigns/create-with-media
 * Cria uma campanha com status 'pending_upload' e gera signed upload URL
 * 
 * Body:
 * {
 *   text: string (obrigatório)
 *   mediaType: 'image' | 'video' | 'audio' (obrigatório)
 *   mime: string (obrigatório, ex: 'image/jpeg')
 *   size: number (obrigatório, tamanho em bytes)
 *   originalName: string (obrigatório, nome original do arquivo)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    // Validação dos campos obrigatórios
    const { text, mediaType, mime, size, originalName } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return errorResponse('Campo "text" é obrigatório e não pode estar vazio');
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
      image: 1024 * 1024 * 1024, // 1GB
      video: 1024 * 1024 * 1024, // 1GB
      audio: 1024 * 1024 * 1024, // 1GB
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
    const storagePath = `campaigns/${userId}/${mediaType}/${fileName}`;

    // Cria a campanha no banco com status 'pending_upload'
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns_media')
      .insert({
        owner_id: userId,
        text: text.trim(),
        media_type: mediaType,
        media_bucket: BUCKET_NAME,
        media_path: storagePath,
        media_mime: mime,
        media_size: size,
        status: 'pending_upload',
      })
      .select()
      .single();

    if (campaignError || !campaign) {
      console.error('[create-with-media] Erro ao criar campanha:', campaignError);
      return serverErrorResponse('Erro ao criar campanha no banco de dados');
    }

    // Gera signed upload URL
    // O Supabase Storage usa createSignedUploadUrl para gerar URL de upload
    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
      .storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(storagePath, {
        upsert: false, // Não sobrescrever se já existir
      });

    if (signedUrlError || !signedUrlData) {
      console.error('[create-with-media] Erro ao gerar signed upload URL:', signedUrlError);
      
      // Marca campanha como erro
      await supabaseServiceRole
        .from('campaigns_media')
        .update({ status: 'error' })
        .eq('id', campaign.id);

      return serverErrorResponse('Erro ao gerar URL de upload assinada');
    }

    // A API retorna { path, token } ou { signedUrl, token }
    // Vamos retornar ambos para compatibilidade
    return successResponse({
      campaignId: campaign.id,
      bucket: BUCKET_NAME,
      path: storagePath,
      token: signedUrlData.token,
      signedUrl: signedUrlData.signedUrl || signedUrlData.path,
    });
  } catch (err: any) {
    console.error('[create-with-media] Erro inesperado:', err);
    return serverErrorResponse(err.message || 'Erro ao criar campanha com mídia');
  }
}

