/**
 * GET /api/maturation/can-access
 * Verifica se o usuário pode acessar a página do Maturador.
 * Retorna canAccess: true se for super_admin/admin/auditoria OU se o cargo tiver o item "maturador" visível na sidebar (permissões por cargo).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse } from '@/lib/utils/response';
import { getUserProfile, hasFullAdminAccess, type UserProfile } from '@/lib/middleware/permissions';
import { getTenantForUser, getRoleByCode, getVisibleSidebarCodesForRole, hasZaplotoTables } from '@/lib/services/zaploto-tenant-service';

type MaturationAccessPayload = {
  canAccess: boolean;
  /** Status real do perfil (evita `sessionStorage` desatualizado no cliente). */
  profileStatus: string | null;
  /** Apenas super_admin/admin: ver todos os planos, card “Configurar plano de conversas”, Auto maturador no select. */
  canManageAllMaturationPlans: boolean;
};

function buildMaturationAccessPayload(canAccess: boolean, profile: UserProfile | null): MaturationAccessPayload {
  const status = profile?.status != null ? String(profile.status).trim() : null;
  return {
    canAccess,
    profileStatus: status,
    canManageAllMaturationPlans: status === 'super_admin' || status === 'admin',
  };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    if (!profile) {
      return successResponse(buildMaturationAccessPayload(false, null));
    }

    if (hasFullAdminAccess(profile)) {
      return successResponse(buildMaturationAccessPayload(true, profile));
    }

    const hasTables = await hasZaplotoTables();
    if (!hasTables) {
      return successResponse(buildMaturationAccessPayload(false, profile));
    }

    const tenant = await getTenantForUser(userId);
    const zaplotoId = tenant?.id ?? '00000000-0000-0000-0000-000000000001';
    const role = await getRoleByCode(zaplotoId, profile.status || '');
    if (!role) {
      return successResponse(buildMaturationAccessPayload(false, profile));
    }

    const sidebarCodes = await getVisibleSidebarCodesForRole(zaplotoId, role.id);
    const canAccess = sidebarCodes.has('maturador');

    return successResponse(buildMaturationAccessPayload(canAccess, profile));
  } catch {
    return successResponse(buildMaturationAccessPayload(false, null));
  }
}
