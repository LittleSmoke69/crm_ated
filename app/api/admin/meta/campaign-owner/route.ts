/**
 * POST /api/admin/meta/campaign-owner
 * Reatribui campanha + adsets + insights para outra banca da mesma integração compartilhada.
 * Body: { banca_id, source_banca_id, target_banca_id, campaign_id }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assignCampaignToBanca } from '@/lib/services/meta-sync-service';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = String(body?.banca_id ?? '').trim();
    const sourceBancaId = String(body?.source_banca_id ?? '').trim();
    const targetBancaId = String(body?.target_banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();

    if (!bancaId || !sourceBancaId || !targetBancaId || !campaignId) {
      return errorResponse('banca_id, source_banca_id, target_banca_id e campaign_id são obrigatórios.', 400);
    }

    const result = await assignCampaignToBanca(bancaId, sourceBancaId, targetBancaId, campaignId);
    if (!result.success) {
      return errorResponse(result.error || 'Erro ao reatribuir campanha.', 400);
    }
    return successResponse(result);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
