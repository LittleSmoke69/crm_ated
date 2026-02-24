import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDonoBancaDashboardData, getDashboardDataByBancaId } from '@/lib/services/dashboard/dono-banca';

/**
 * GET /api/dono-banca/dashboard - Dashboard do Dono de Banca (ou por banca para super_admin/admin)
 * - dono_banca: métricas da própria banca.
 * - super_admin/admin: query banca_id obrigatória; retorna dados da banca selecionada.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['dono_banca', 'super_admin', 'admin']);

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    if (isAdminOrSuperAdmin) {
      if (!bancaId) {
        return errorResponse('Para super_admin e admin é obrigatório informar banca_id na URL.', 400);
      }
      const data = await getDashboardDataByBancaId({
        bancaId,
        dateFrom: dateFrom ?? undefined,
        dateTo: dateTo ?? undefined,
      });
      return successResponse(data);
    }

    // Dono de banca: comportamento original
    const data = await getDonoBancaDashboardData({
      userId,
      dateFrom,
      dateTo
    });

    return successResponse(data);
  } catch (err: any) {
    console.error('[Dashboard API] Erro:', err.message);

    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado') || err.message?.includes('Usuário inválido')) {
      return errorResponse(err.message, 403);
    }
    if (err.message?.includes('Banca não encontrada')) {
      return errorResponse(err.message, 404);
    }

    return serverErrorResponse(err);
  }
}
