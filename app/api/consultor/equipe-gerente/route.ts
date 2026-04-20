import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { buildGerentePerformanceScope } from '@/lib/services/dashboard/gerente-desempenho-scope';

/**
 * GET /api/consultor/equipe-gerente
 * Lista perfis que o gerente pode ver em Meu Desempenho: ele mesmo + consultores da hierarquia.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const list = await buildGerentePerformanceScope(userId);
    return successResponse(list);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[equipe-gerente]', message);
    if (message.includes('Acesso negado')) {
      return errorResponse(message, 403);
    }
    return serverErrorResponse(err);
  }
}
