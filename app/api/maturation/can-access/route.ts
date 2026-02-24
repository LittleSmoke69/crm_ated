/**
 * GET /api/maturation/can-access
 * Verifica se o usuário pode acessar a página do Maturador.
 * Retorna canAccess: true se for super_admin/admin/auditoria OU se o cargo tiver o item "maturador" visível na sidebar (permissões por cargo).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse } from '@/lib/utils/response';
import { getUserProfile, hasFullAdminAccess } from '@/lib/middleware/permissions';
import { getTenantForUser, getRoleByCode, getVisibleSidebarCodesForRole, hasZaplotoTables } from '@/lib/services/zaploto-tenant-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    if (!profile) {
      return successResponse({ canAccess: false });
    }

    if (hasFullAdminAccess(profile)) {
      return successResponse({ canAccess: true });
    }

    const hasTables = await hasZaplotoTables();
    if (!hasTables) {
      return successResponse({ canAccess: false });
    }

    const tenant = await getTenantForUser(userId);
    const zaplotoId = tenant?.id ?? '00000000-0000-0000-0000-000000000001';
    const role = await getRoleByCode(zaplotoId, profile.status || '');
    if (!role) {
      return successResponse({ canAccess: false });
    }

    const sidebarCodes = await getVisibleSidebarCodesForRole(zaplotoId, role.id);
    const canAccess = sidebarCodes.has('maturador');

    return successResponse({ canAccess });
  } catch {
    return successResponse({ canAccess: false });
  }
}
