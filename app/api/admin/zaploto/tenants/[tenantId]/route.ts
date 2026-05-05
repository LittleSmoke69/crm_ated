import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveTenantBrandingRow } from '@/lib/server/tenant-branding';
import {
  normalizeThemeColorsInput,
  resolveTenantPalettes,
  type TenantThemeColorsStored,
} from '@/lib/constants/tenant-theme-map';

/**
 * GET /api/admin/zaploto/tenants/[tenantId] - Busca um tenant
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { tenantId } = await params;

    const { data, error } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (error || !data) return errorResponse('Tenant não encontrado', 404);
    const row = data as {
      logo_url?: string | null;
      favicon_url?: string | null;
      theme_colors?: unknown;
      primary_color?: string | null;
      secondary_color?: string | null;
    };
    const branding = await resolveTenantBrandingRow(row);
    const theme = resolveTenantPalettes({
      theme_colors: (row.theme_colors as TenantThemeColorsStored | null) ?? null,
      primary_color: row.primary_color,
      secondary_color: row.secondary_color,
    });
    return successResponse({
      ...data,
      logo_url: branding.logo_url,
      favicon_url: branding.favicon_url,
      /** Valor bruto no banco (URL https ou caminho no storage); usar ao salvar */
      logo_source: row.logo_url ?? null,
      favicon_source: row.favicon_url ?? null,
      theme,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar tenant';
    return errorResponse(message, 403);
  }
}

/**
 * PUT /api/admin/zaploto/tenants/[tenantId] - Atualiza tenant
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { tenantId } = await params;
    const body = await req.json();

    const update: Record<string, unknown> = {};
    if (body.name != null) update.name = body.name;
    if (body.slug != null) update.slug = body.slug;
    if (body.domain != null) update.domain = body.domain;
    if ('logo_url' in body) {
      const v = body.logo_url;
      update.logo_url = v == null || v === '' ? null : v;
    }
    if ('favicon_url' in body) {
      const v = body.favicon_url;
      update.favicon_url = v == null || v === '' ? null : v;
    }
    if (body.primary_color != null) update.primary_color = body.primary_color;
    if ('secondary_color' in body) {
      const v = body.secondary_color;
      update.secondary_color = v == null || v === '' ? null : v;
    }
    if ('theme_colors' in body) {
      update.theme_colors = normalizeThemeColorsInput(body.theme_colors);
    }
    if (body.app_title != null) update.app_title = body.app_title;
    if (body.support_email != null) update.support_email = body.support_email;
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

    update.updated_at = new Date().toISOString();

    const { data, error } = await supabaseServiceRole
      .from('zaploto_tenants')
      .update(update)
      .eq('id', tenantId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    const row = data as {
      logo_url?: string | null;
      favicon_url?: string | null;
      theme_colors?: unknown;
      primary_color?: string | null;
      secondary_color?: string | null;
    };
    const branding = await resolveTenantBrandingRow(row);
    const theme = resolveTenantPalettes({
      theme_colors: (row.theme_colors as TenantThemeColorsStored | null) ?? null,
      primary_color: row.primary_color,
      secondary_color: row.secondary_color,
    });
    return successResponse({
      ...data,
      logo_url: branding.logo_url,
      favicon_url: branding.favicon_url,
      logo_source: row.logo_url ?? null,
      favicon_source: row.favicon_url ?? null,
      theme,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar tenant';
    return errorResponse(message, 403);
  }
}

const CENTRAL_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/**
 * DELETE /api/admin/zaploto/tenants/[tenantId] - Remove um tenant (white label).
 * Não permite deletar o Zaploto Central.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { tenantId } = await params;

    if (tenantId === CENTRAL_ZAPLOTO_ID) {
      return errorResponse('Não é possível excluir o Zaploto Central.', 400);
    }

    const { data: tenant, error: fetchError } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('id, is_central')
      .eq('id', tenantId)
      .maybeSingle();

    if (fetchError || !tenant) return errorResponse('Tenant não encontrado', 404);
    if ((tenant as { is_central?: boolean }).is_central) {
      return errorResponse('Não é possível excluir o Zaploto Central.', 400);
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('zaploto_tenants')
      .delete()
      .eq('id', tenantId);

    if (deleteError) throw new Error(deleteError.message);
    return successResponse({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir tenant';
    return errorResponse(message, 403);
  }
}
