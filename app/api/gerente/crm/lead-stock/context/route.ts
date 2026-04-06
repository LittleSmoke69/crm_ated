import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca, resolveGerenteStockPoolEmail, getBancaCrmBaseForTransfer } from '@/lib/server/crm/gerenteLeadStock';

/**
 * GET /api/gerente/crm/lead-stock/context?banca_id=
 * E-mail do estoque e metadados da banca para o fluxo de transferência do gerente.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) {
      return errorResponse('Banca não disponível.', 403);
    }

    const poolEmail = await resolveGerenteStockPoolEmail(userId, bancaId);
    const banca = await getBancaCrmBaseForTransfer(bancaId);

    return successResponse({
      banca_id: bancaId,
      banca_name: banca?.bancaName ?? null,
      pool_consultant_email: poolEmail,
      stock_configured: !!poolEmail,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
