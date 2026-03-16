import { NextRequest } from 'next/server';
import { getUserProfile, hasFullAdminAccess, hasSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

/**
 * GET /api/user/can-access-admin?userId=xxx
 * Verifica se o usuário pode acessar o painel admin (para fluxo de login).
 * Retorna canAccess: true se super_admin, admin, auditoria ou cargo com painel_admin/hierarquia na sidebar.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')?.trim();
    if (!userId) return errorResponse('Parâmetro userId é obrigatório', 400);

    const profile = await getUserProfile(userId);
    if (!profile) {
      return successResponse({ canAccess: false });
    }

    if (hasFullAdminAccess(profile)) {
      return successResponse({ canAccess: true });
    }
    const hasPanel = await hasSidebarPermission(profile, 'painel_admin');
    if (hasPanel) return successResponse({ canAccess: true });
    const hasHierarchy = await hasSidebarPermission(profile, 'hierarquia');
    if (hasHierarchy) return successResponse({ canAccess: true });

    return successResponse({ canAccess: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao verificar acesso';
    return errorResponse(message, 500);
  }
}
