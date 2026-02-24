import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getAdminStepsForRole, getTenantForUser, hasZaplotoTables } from '@/lib/services/zaploto-tenant-service';
import { hasFullAdminAccess } from '@/lib/middleware/permissions';

/**
 * GET /api/zaploto/admin-steps - Retorna steps do painel admin visíveis para o usuário
 * Apenas para admin/super_admin
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuthWithProfile(req);

    if (!hasFullAdminAccess(profile)) {
      return successResponse({ steps: [], useLegacy: true });
    }

    const status = profile.status || 'admin';
    const hasTables = await hasZaplotoTables();
    if (!hasTables) {
      return successResponse({ steps: [], useLegacy: true });
    }

    const tenant = await getTenantForUser(profile.id);
    const zaplotoId = tenant?.id || '00000000-0000-0000-0000-000000000001';

    const steps = await getAdminStepsForRole(zaplotoId, status);

    return successResponse({
      steps,
      useLegacy: steps.length === 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar admin steps';
    return errorResponse(message, 401);
  }
}
