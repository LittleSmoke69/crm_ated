import { NextRequest } from 'next/server';
import { isLeadStockAdminViewer, requireLeadStockViewer } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { listStockPackageLeads } from '@/lib/server/crm/gerenteStockReservation';

/**
 * GET /api/gerente/crm/lead-stock/package-leads?banca_id=&transfer_log_id=&status=&gerente_user_id=
 * - Gerente: estoque próprio (não precisa gerente_user_id).
 * - Admin/super_admin: obrigatório gerente_user_id (dono do estoque daquele pacote).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadStockViewer(req);
    const { searchParams } = req.nextUrl;
    const bancaId = searchParams.get('banca_id')?.trim();
    const transferLogId = searchParams.get('transfer_log_id')?.trim();
    const gerenteParam = searchParams.get('gerente_user_id')?.trim() || null;
    const statusRaw = (searchParams.get('status')?.trim() ?? 'em_estoque').toLowerCase();
    const allowedStatus = new Set(['em_estoque', 'repassado', 'cancelado', 'all']);
    const status = (allowedStatus.has(statusRaw) ? statusRaw : 'em_estoque') as
      | 'em_estoque'
      | 'repassado'
      | 'cancelado'
      | 'all';

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
    if (!transferLogId) return errorResponse('transfer_log_id é obrigatório.', 400);

    let effectiveGerenteId: string;

    if (isLeadStockAdminViewer(profile)) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 404);
      if (!gerenteParam) {
        return errorResponse('Para admin/super_admin, informe gerente_user_id (dono do estoque do pacote).', 400);
      }
      const ok = await assertGerenteHasBanca(gerenteParam, bancaId);
      if (!ok) return errorResponse('Gerente não pertence a esta banca.', 403);
      effectiveGerenteId = gerenteParam;
    } else {
      const has = await assertGerenteHasBanca(userId, bancaId);
      if (!has) return errorResponse('Banca não disponível.', 403);
      if (gerenteParam && gerenteParam !== userId) {
        return errorResponse('Sem permissão para consultar outro gerente.', 403);
      }
      effectiveGerenteId = userId;
    }

    const { package: pkg, leads } = await listStockPackageLeads(effectiveGerenteId, bancaId, transferLogId, {
      statusFilter: status,
    });

    if (!pkg) return errorResponse('Pacote não encontrado para este gerente/banca.', 404);

    return successResponse({
      banca_id: bancaId,
      viewer_role: isLeadStockAdminViewer(profile) ? 'admin' : 'gerente',
      gerente_user_id: effectiveGerenteId,
      package: pkg,
      leads,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
