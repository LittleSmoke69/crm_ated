/**
 * GET /api/admin/zaploto/central/check
 * Retorna se o tenant do usuário é o Zaploto Central (pode enviar dados para white labels).
 * Requer super_admin.
 */

import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { isCentralTenant } from '@/lib/services/central-push-service';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const zaplotoId = profile?.zaploto_id ?? '00000000-0000-0000-0000-000000000001';
    const is_central = await isCentralTenant(zaplotoId);
    return successResponse({ is_central });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao verificar central';
    return errorResponse(message, 403);
  }
}
