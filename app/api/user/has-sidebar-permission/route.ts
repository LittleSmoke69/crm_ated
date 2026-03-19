import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { hasSidebarPermission } from '@/lib/middleware/permissions';

/**
 * GET /api/user/has-sidebar-permission?code=xxx - Verifica se o usuário tem permissão na sidebar para o item.
 * Usado por páginas client-side para checar acesso de cargos personalizados.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuthWithProfile(req);
    const code = req.nextUrl.searchParams.get('code')?.trim();
    if (!code) return errorResponse('Parâmetro code é obrigatório', 400);

    const hasPermission = await hasSidebarPermission(profile, code);
    return successResponse({ hasPermission });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao verificar permissão', 401);
  }
}
