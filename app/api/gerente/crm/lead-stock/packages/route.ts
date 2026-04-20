import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { listStockPackagesForGerente } from '@/lib/server/crm/gerenteStockReservation';

/**
 * GET /api/gerente/crm/lead-stock/packages?banca_id=
 * Lista os pacotes de reserva (admin→estoque) pendentes/repassados/cancelados do gerente na banca.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);

    const packages = await listStockPackagesForGerente(userId, bancaId);
    return successResponse({ banca_id: bancaId, packages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
