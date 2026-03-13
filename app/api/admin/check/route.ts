import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse } from '@/lib/utils/response';
import { getUserProfile, hasFullAdminAccess, isSuperAdmin, hasSidebarPermission } from '@/lib/middleware/permissions';

/**
 * GET /api/admin/check - Verifica se o usuário pode acessar o painel admin.
 * super_admin, admin, auditoria ou cargo personalizado com painel_admin/hierarquia na sidebar.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    if (!profile) {
      return successResponse({ isAdmin: false, status: null, isActive: false });
    }

    const hasAccess = hasFullAdminAccess(profile) ||
      (await hasSidebarPermission(profile, 'painel_admin')) ||
      (await hasSidebarPermission(profile, 'hierarquia'));

    if (!hasAccess) {
      return successResponse({ isAdmin: false, status: null, isActive: false });
    }

    return successResponse({
      isAdmin: true,
      status: profile.status,
      isSuperAdmin: isSuperAdmin(profile),
      isActive: true,
    });
  } catch {
    return successResponse({ isAdmin: false, status: null, isActive: false });
  }
}

