import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getAdminStepPermission, getTenantForUser, hasZaplotoTables } from '@/lib/services/zaploto-tenant-service';
import { hasFullAdminAccess } from '@/lib/middleware/permissions';

/**
 * GET /api/zaploto/admin-step-permission?step=lead_transfer
 * Retorna { visible, can_execute } para o step indicado.
 * Super_admin/admin/auditoria: acesso total. Gerente: lead_transfer visível sem executar transferências admin.
 * Cargos personalizados: permissão conforme atribuição do cargo (sem exceção).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuthWithProfile(req);

    const step = req.nextUrl.searchParams.get('step');
    if (!step) return errorResponse('step é obrigatório', 400);

    if (hasFullAdminAccess(profile)) {
      return successResponse({ visible: true, can_execute: true });
    }

    if (step === 'lead_transfer' && profile.status === 'gerente') {
      return successResponse({ visible: true, can_execute: false });
    }

    const hasTables = await hasZaplotoTables();
    if (!hasTables) {
      return successResponse({ visible: false, can_execute: false });
    }

    const tenant = await getTenantForUser(profile.id);
    const zaplotoId = tenant?.id || '00000000-0000-0000-0000-000000000001';
    const roleCode = profile.status?.trim() || '';

    const perm = await getAdminStepPermission(zaplotoId, roleCode, step);
    return successResponse(perm);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar permissão';
    return errorResponse(message, 401);
  }
}
