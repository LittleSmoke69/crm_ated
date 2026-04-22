import { NextRequest } from 'next/server';
import { isLeadStockAdminViewer, requireLeadStockViewer } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { listStockPackagesAllGerentesForBanca, listStockPackagesForGerente } from '@/lib/server/crm/gerenteStockReservation';

/**
 * GET /api/gerente/crm/lead-stock/packages?banca_id=&gerente_user_id=
 * - Gerente: lista o próprio estoque na banca (ignora gerente_user_id).
 * - Admin/super_admin: sem gerente_user_id = todos os gerentes com estoque nesta banca;
 *   com gerente_user_id = estoque apenas desse gerente (deve estar na banca).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadStockViewer(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    const gerenteParam = req.nextUrl.searchParams.get('gerente_user_id')?.trim() || null;
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    if (isLeadStockAdminViewer(profile)) {
      const resolved = await getAdminBancaId(userId, profile, bancaId, { skipLeadTransferLock: true });
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 404);

      if (gerenteParam) {
        const ok = await assertGerenteHasBanca(gerenteParam, bancaId);
        if (!ok) return errorResponse('Gerente não pertence a esta banca.', 403);
        const packages = await listStockPackagesForGerente(gerenteParam, bancaId);
        return successResponse({
          banca_id: bancaId,
          viewer_role: 'admin',
          gerente_user_id_filter: gerenteParam,
          packages: packages.map((p) => ({
            ...p,
            stock_gerente_user_id: gerenteParam,
            gerente_name: null as string | null,
          })),
        });
      }

      const packages = await listStockPackagesAllGerentesForBanca(bancaId);
      return successResponse({
        banca_id: bancaId,
        viewer_role: 'admin',
        gerente_user_id_filter: null,
        packages,
      });
    }

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);
    if (gerenteParam && gerenteParam !== userId) {
      return errorResponse('Sem permissão para consultar outro gerente.', 403);
    }

    const packages = await listStockPackagesForGerente(userId, bancaId);
    return successResponse({
      banca_id: bancaId,
      viewer_role: 'gerente',
      gerente_user_id_filter: userId,
      packages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
