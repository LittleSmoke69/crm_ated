import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { listStockPackageLeads } from '@/lib/server/crm/gerenteStockReservation';

/**
 * GET /api/gerente/crm/lead-stock/package-leads?banca_id=&transfer_log_id=&status=em_estoque|all
 * Leads de um pacote específico (a partir dos snapshots gravados na reserva).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const { searchParams } = req.nextUrl;
    const bancaId = searchParams.get('banca_id')?.trim();
    const transferLogId = searchParams.get('transfer_log_id')?.trim();
    const statusRaw = (searchParams.get('status')?.trim() ?? 'em_estoque').toLowerCase();
    const allowedStatus = new Set(['em_estoque', 'repassado', 'cancelado', 'all']);
    const status = (allowedStatus.has(statusRaw) ? statusRaw : 'em_estoque') as
      | 'em_estoque'
      | 'repassado'
      | 'cancelado'
      | 'all';

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
    if (!transferLogId) return errorResponse('transfer_log_id é obrigatório.', 400);

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);

    const { package: pkg, leads } = await listStockPackageLeads(userId, bancaId, transferLogId, {
      statusFilter: status,
    });

    if (!pkg) return errorResponse('Pacote não encontrado para este gerente/banca.', 404);

    return successResponse({ banca_id: bancaId, package: pkg, leads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
