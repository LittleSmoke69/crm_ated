import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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
    return successResponse(data);
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
    if (body.logo_url != null) update.logo_url = body.logo_url;
    if (body.favicon_url != null) update.favicon_url = body.favicon_url;
    if (body.primary_color != null) update.primary_color = body.primary_color;
    if (body.secondary_color != null) update.secondary_color = body.secondary_color;
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
    return successResponse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar tenant';
    return errorResponse(message, 403);
  }
}
