import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getTenantForUser } from '@/lib/services/zaploto-tenant-service';

/**
 * GET /api/zaploto/tenant - Retorna o tenant (white label) do usuário logado
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const tenant = await getTenantForUser(userId);

    if (!tenant) {
      return successResponse({
        id: null,
        name: 'ZapLoto',
        slug: 'zaploto',
        app_title: 'ZapLoto',
        primary_color: '#8CD955',
        logo_url: null,
        favicon_url: null,
        secondary_color: null,
        support_email: null,
      });
    }

    return successResponse({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      app_title: tenant.app_title || 'ZapLoto',
      primary_color: tenant.primary_color,
      secondary_color: tenant.secondary_color,
      logo_url: tenant.logo_url,
      favicon_url: tenant.favicon_url,
      support_email: tenant.support_email,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar tenant';
    return errorResponse(message, 401);
  }
}
