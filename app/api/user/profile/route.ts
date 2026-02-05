import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getUserBancas } from '@/lib/utils/user-bancas';

/**
 * GET /api/user/profile - Retorna perfil completo do usuário autenticado com bancas
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAuthWithProfile(req);

    // Busca bancas do usuário
    const bancas = await getUserBancas(userId);

    return successResponse({
      id: userId,
      email: profile.email,
      full_name: profile.full_name,
      telefone: profile.telefone,
      status: profile.status,
      enroller: profile.enroller,
      created_at: profile.created_at,
      bancas: bancas,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar perfil', 401);
  }
}

