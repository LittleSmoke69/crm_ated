import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/zaploto/tenants/create - Cria novo tenant (white label)
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();

    const name = String(body.name || '').trim();
    const slug = String(body.slug || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !slug) {
      return errorResponse('Nome e slug são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('zaploto_tenants')
      .insert({
        name,
        slug,
        domain: body.domain?.trim() || null,
        logo_url: body.logo_url?.trim() || null,
        favicon_url: body.favicon_url?.trim() || null,
        primary_color: body.primary_color || '#8CD955',
        secondary_color: body.secondary_color?.trim() || null,
        app_title: body.app_title?.trim() || name,
        support_email: body.support_email?.trim() || null,
        is_active: body.is_active !== false,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      throw new Error(error.message);
    }
    return successResponse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao criar tenant';
    return errorResponse(message, 403);
  }
}
