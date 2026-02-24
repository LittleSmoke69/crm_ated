import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { getUserBancas } from '@/lib/utils/user-bancas';

/**
 * GET /api/user/bancas
 * Retorna as bancas do usuário autenticado
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const bancas = await getUserBancas(userId);
    return successResponse(bancas);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
