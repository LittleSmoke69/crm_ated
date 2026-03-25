import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDonoBancaDashboardData, getDashboardDataByBancaId } from '@/lib/services/dashboard/dono-banca';

/** Netlify/Vercel: dashboard agrega CRM por muitos consultores — precisa de limite alto para evitar 504/HTML de erro. */
export const maxDuration = 300;

/**
 * GET /api/dono-banca/dashboard - Dashboard do Dono de Banca (ou por banca para super_admin/admin/cargos personalizados)
 * - dono_banca: métricas da própria banca.
 * - super_admin/admin ou cargo personalizado com gestao_banca na sidebar: banca_id obrigatório; retorna dados da banca selecionada.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(req, ['dono_banca', 'super_admin', 'admin'], 'gestao_banca');

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    /** Paginação opcional: quando presente, o serviço processa só N gerentes por request (evita 504/edge HTML na Netlify). */
    const hasPaging = searchParams.has('limit') || searchParams.has('offset');
    const gerentesLimit = hasPaging
      ? Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5', 10) || 5, 1), 1000)
      : undefined;
    const gerentesOffset = hasPaging
      ? Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
      : undefined;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';

    let data: Awaited<ReturnType<typeof getDonoBancaDashboardData>> | Awaited<ReturnType<typeof getDashboardDataByBancaId>>;

    // Super_admin, admin ou cargo personalizado com gestao_banca: precisa selecionar banca
    if (isAdminOrSuperAdmin || !isDonoBanca) {
      if (!bancaId) {
        return errorResponse('Informe banca_id na URL para visualizar os dados da banca.', 400);
      }
      data = await getDashboardDataByBancaId({
        bancaId,
        dateFrom: dateFrom ?? undefined,
        dateTo: dateTo ?? undefined,
        gerentesOffset,
        gerentesLimit,
      });
    } else {
      // Dono de banca: comportamento original (usa banca do perfil)
      data = await getDonoBancaDashboardData({
        userId,
        dateFrom,
        dateTo,
        gerentesOffset,
        gerentesLimit,
      });
    }

    const totalGerentes =
      (data as { totalGerentes?: number }).totalGerentes ?? data.gerentes?.length ?? 0;
    const hasMore = (data as { hasMoreGerentes?: boolean }).hasMoreGerentes ?? false;

    return successResponse({
      ...data,
      totalGerentes,
      hasMore,
    });
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
