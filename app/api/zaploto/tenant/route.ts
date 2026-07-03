import { NextRequest } from 'next/server';
import { authenticateRequest, validateUser } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { ZAPLOTO_SLUG_COOKIE } from '@/lib/constants/white-label';
import { successResponse, errorResponse } from '@/lib/utils/response';
import {
  getTenantByIdOrSlug,
  getTenantForUser,
} from '@/lib/services/zaploto-tenant-service';
import { resolveTenantBrandingRow } from '@/lib/server/tenant-branding';
import { resolveTenantPalettes } from '@/lib/constants/tenant-theme-map';
import type { TenantThemeColorsStored } from '@/lib/constants/tenant-theme-map';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

const defaultPayload = () => ({
  id: null,
  name: 'crmTR',
  slug: 'zaploto',
  app_title: 'crmTR',
  primary_color: '#E86A24',
  logo_url: null,
  favicon_url: null,
  secondary_color: null,
  support_email: null,
  theme_colors: null as TenantThemeColorsStored | null,
  theme: resolveTenantPalettes({}),
});

/**
 * GET /api/zaploto/tenant
 * Tenant por slug (query, cookie ou header) — inclusive anônimos (/login branded).
 * Com usuário autenticado, valida que o slug bate no perfil (exceto super_admin).
 */
export async function GET(req: NextRequest) {
  try {
    /** Página /login, /register etc. central — cliente envia para ignorar cookie WL no branding */
    if (req.nextUrl.searchParams.get('central') === '1') {
      return successResponse(defaultPayload());
    }

    const slug =
      req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() ||
      req.headers.get('x-zaploto-slug')?.trim().toLowerCase() ||
      req.cookies.get(ZAPLOTO_SLUG_COOKIE)?.value?.trim().toLowerCase() ||
      '';

    const tenantBySlug = slug ? await getTenantByIdOrSlug(slug) : null;

    const auth = await authenticateRequest(req);
    let userId: string | null = auth?.userId?.trim() || null;

    if (userId) {
      try {
        const ok = await validateUser(userId);
        if (!ok) userId = null;
      } catch (e: unknown) {
        const sc =
          typeof e === 'object' && e !== null && 'statusCode' in e
            ? Number((e as { statusCode?: number }).statusCode)
            : undefined;
        if (sc === 503) {
          return errorResponse(e instanceof Error ? e.message : 'Serviço indisponível', 503);
        }
        userId = null;
      }
    }

    if (userId && tenantBySlug) {
      const profile = await getUserProfile(userId);
      if (profile && profile.status !== 'super_admin') {
        const pid = profile.zaploto_id || DEFAULT_ZAPLOTO_ID;
        if (pid !== tenantBySlug.id) {
          return errorResponse('Sessão incompatível com este painel white label.', 403);
        }
      }
    }

    let tenant = tenantBySlug;
    if (!tenant && userId) {
      tenant = await getTenantForUser(userId);
    }

    if (!tenant) {
      return successResponse(defaultPayload());
    }

    const branding = await resolveTenantBrandingRow(tenant);
    const theme_colors =
      (tenant as { theme_colors?: TenantThemeColorsStored | null }).theme_colors ?? null;
    const theme = resolveTenantPalettes({
      theme_colors,
      primary_color: tenant.primary_color,
      secondary_color: tenant.secondary_color,
    });

    return successResponse({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      app_title: tenant.app_title === 'crm-atendimento' ? 'crmTR' : (tenant.app_title || 'crmTR'),
      primary_color: tenant.primary_color,
      secondary_color: tenant.secondary_color,
      logo_url: branding.logo_url,
      favicon_url: branding.favicon_url,
      support_email: tenant.support_email,
      theme_colors,
      theme,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar tenant';
    const status =
      typeof err === 'object' &&
      err !== null &&
      'statusCode' in err &&
      (err as { statusCode?: number }).statusCode === 503
        ? 503
        : 401;
    return errorResponse(message, status);
  }
}
