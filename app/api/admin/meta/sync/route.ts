/**
 * POST /api/admin/meta/sync - Executa sincronização (campanhas, adsets, insights)
 * Body: { banca_id: string, date_preset?: string } - date_preset default: last_30d
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { runSync } from '@/lib/services/meta-sync-service';
import { isMetaVerboseLogEnabled } from '@/lib/utils/meta-debug-log';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = body?.banca_id;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const datePreset = body?.date_preset || 'last_30d';

    const result = await runSync(bancaId, datePreset);
    if (!result.success) {
      return successResponse({
        success: false,
        error: result.error,
      });
    }

    if (isMetaVerboseLogEnabled()) {
      console.log('[admin/meta API] POST sync ok', {
        banca_id: bancaId,
        campaignsCount: result.campaignsCount ?? 0,
        insightsCount: result.insightsCount ?? 0,
      });
    }
    return successResponse({
      success: true,
      campaignsCount: result.campaignsCount,
      adsetsCount: result.adsetsCount,
      insightsCount: result.insightsCount,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
