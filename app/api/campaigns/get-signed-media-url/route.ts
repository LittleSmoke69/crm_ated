import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/campaigns/get-signed-media-url
 * Gera uma signed URL para acessar a mídia da campanha (para disparo)
 * 
 * Body:
 * {
 *   campaignId: string (obrigatório)
 *   expiresInSeconds?: number (opcional, padrão: 31536000 = 1 ano)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    const { campaignId, expiresInSeconds = 31536000 } = body; // Padrão: 1 ano

    if (!campaignId || typeof campaignId !== 'string') {
      return errorResponse('Campo "campaignId" é obrigatório');
    }

    if (typeof expiresInSeconds !== 'number' || expiresInSeconds <= 0 || expiresInSeconds > 31536000) {
      return errorResponse('expiresInSeconds deve ser um número entre 1 e 31536000 (1 ano)');
    }

    // Busca a campanha e valida ownership
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns_media')
      .select('id, owner_id, media_bucket, media_path, status')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Valida que o usuário é o dono da campanha
    if (campaign.owner_id !== userId) {
      return errorResponse('Acesso negado. Você não é o dono desta campanha.', 403);
    }

    // Valida que a campanha está pronta
    if (campaign.status !== 'ready') {
      return errorResponse(
        `Campanha não está pronta. Status atual: ${campaign.status}`,
        400
      );
    }

    // Valida que tem mídia
    if (!campaign.media_bucket || !campaign.media_path) {
      return errorResponse('Campanha não possui mídia associada', 400);
    }

    // Gera signed URL para leitura
    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
      .storage
      .from(campaign.media_bucket)
      .createSignedUrl(campaign.media_path, expiresInSeconds);

    if (signedUrlError || !signedUrlData) {
      console.error('[get-signed-media-url] Erro ao gerar signed URL:', signedUrlError);
      return serverErrorResponse('Erro ao gerar URL assinada para a mídia');
    }

    return successResponse({
      signedUrl: signedUrlData.signedUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      campaignId: campaign.id,
    });
  } catch (err: any) {
    console.error('[get-signed-media-url] Erro inesperado:', err);
    return serverErrorResponse(err.message || 'Erro ao gerar URL assinada');
  }
}

