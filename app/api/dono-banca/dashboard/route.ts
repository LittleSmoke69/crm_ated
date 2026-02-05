import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDonoBancaDashboardData } from '@/lib/services/dashboard/dono-banca';

/**
 * GET /api/dono-banca/dashboard - Dashboard do Dono de Banca
 * Métricas globais da banca incluindo todos os subordinados
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['dono_banca']);

    // Busca parâmetros de data da query string
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const data = await getDonoBancaDashboardData({
      userId,
      dateFrom,
      dateTo
    });

    return successResponse(data);
  } catch (err: any) {
    console.error('[Dashboard API] Erro:', err.message);
    
    // Se for erro de acesso negado, retorna erro específico
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado') || err.message?.includes('Usuário inválido')) {
      return errorResponse(err.message, 403);
    }
    
    return serverErrorResponse(err);
  }
}
