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
      return successResponse({
        success: false,
        error: result.error,
      });
    }

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
