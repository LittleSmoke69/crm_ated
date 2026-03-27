/**
 * POST /api/admin/meta/test-connection - Valida token e retorna /me e adaccounts
 * Body: { banca_id: string }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { testConnection } from '@/lib/services/meta-sync-service';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = body?.banca_id;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const result = await testConnection(bancaId);
    if (!result.success) {
      console.log('[admin/meta API] POST test-connection resposta', {
        banca_id: bancaId,
        success: false,
        error: result.error ?? null,
      });
      return successResponse({
        success: false,
        error: result.error,
      });
    }

    console.log('[admin/meta API] POST test-connection resposta', {
      banca_id: bancaId,
      success: true,
      me_id: result.me?.id ?? null,
      ad_accounts_returned: result.adAccounts?.length ?? 0,
    });
    return successResponse({
      success: true,
      me: result.me,
      adAccounts: result.adAccounts,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
