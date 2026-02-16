/**
 * GET /api/admin/meta/campaigns - Lista campanhas da conta Meta (para dropdown)
 * Query: banca_id (UUID) - obrigatório
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { loadCampaigns } from '@/lib/services/meta-sync-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const result = await loadCampaigns(bancaId);
    if (!result.success) {
      return successResponse({
        success: false,
        error: result.error,
        campaigns: [],
      });
    }

    return successResponse({
      success: true,
      campaigns: result.campaigns || [],
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
