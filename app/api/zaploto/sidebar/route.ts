import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getSidebarItemsForRole, getTenantForUser, hasZaplotoTables } from '@/lib/services/zaploto-tenant-service';

/**
 * GET /api/zaploto/sidebar - Retorna itens da sidebar visíveis para o usuário
 * Usa permissões dinâmicas (zaploto_role_sidebar) ou fallback para lógica legada
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAuthWithProfile(req);
    const status = profile.status || 'consultor';

    const hasTables = await hasZaplotoTables();
    if (!hasTables) {
      return successResponse({ items: [], useLegacy: true });
    }

    const tenant = await getTenantForUser(userId);
    const zaplotoId = tenant?.id || '00000000-0000-0000-0000-000000000001';

    const items = await getSidebarItemsForRole(zaplotoId, status);

    return successResponse({
      items,
      useLegacy: items.length === 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar sidebar';
    return errorResponse(message, 401);
  }
}
