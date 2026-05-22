/**
 * POST /api/admin/meta/test-connection - Valida token e retorna /me e adaccounts
 * Body: { banca_id: string }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { isMetaIntegrationLinkedToBanca, testConnection } from '@/lib/services/meta-sync-service';
import { isMetaVerboseLogEnabled } from '@/lib/utils/meta-debug-log';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = body?.banca_id;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const integrationId =
      body?.integration_id != null && String(body.integration_id).trim() !== ''
        ? String(body.integration_id).trim()
        : null;
    if (integrationId) {
      const linked = await isMetaIntegrationLinkedToBanca(integrationId, String(bancaId));
      if (!linked) return errorResponse('integration_id não pertence a esta banca.', 400);
    }

    const result = await testConnection(String(bancaId), integrationId);
    if (!result.success) {
      return successResponse({
        success: false,
        error: result.error,
      });
    }

    if (isMetaVerboseLogEnabled()) {
      console.log('[admin/meta API] POST test-connection ok', { banca_id: bancaId });
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
