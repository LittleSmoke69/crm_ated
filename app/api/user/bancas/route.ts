import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getUserBancas, saveUserBancas } from '@/lib/utils/user-bancas';

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
    console.error('[GET /api/user/bancas] Erro:', err);
    return serverErrorResponse(err);
  }
}

/**
 * PUT /api/user/bancas
 * Salva as bancas escolhidas pelo usuário
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { banca_ids } = body;

    console.log(`[PUT /api/user/bancas] Request for user ${userId}:`, { banca_ids });

    if (!banca_ids || !Array.isArray(banca_ids)) {
      return errorResponse('banca_ids é obrigatório e deve ser um array', 400);
    }

    await saveUserBancas(userId, banca_ids);

    console.log(`[PUT /api/user/bancas] Success for user ${userId}`);
    return successResponse({ success: true });
  } catch (err: any) {
    console.error('[PUT /api/user/bancas] Erro inesperado:', err);
    return serverErrorResponse(err);
  }
}
