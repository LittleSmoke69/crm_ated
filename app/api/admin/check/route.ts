import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse } from '@/lib/utils/response';
import { getUserProfile, hasFullAdminAccess, isSuperAdmin } from '@/lib/middleware/permissions';

/**
 * GET /api/admin/check - Verifica se o usuário pode acessar o painel admin.
 * Apenas super_admin e admin têm acesso (dono_banca não acessa o painel).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    if (!profile || !hasFullAdminAccess(profile)) {
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

