import { NextRequest } from 'next/server';
import { requireVslAdmin, vslProjectsFilterForUser } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * GET /api/admin/vsl/projects
 * Lista projetos VSL. Usuário vê apenas os que criou; super_admin e admin vêem todos.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireVslAdmin(req);
    const { all, ownerUserId } = await vslProjectsFilterForUser(userId);

    let query = supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug, is_active, redirect_timer_seconds, logo_path, pixel_id, banca_id, created_at')
      .order('created_at', { ascending: false });

    if (!all && ownerUserId) {
      query = query.eq('owner_user_id', ownerUserId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[admin/vsl/projects]', error.message);
      return errorResponse('Erro ao listar projetos', 500);
    }
    return successResponse(data ?? []);
  } catch (e: unknown) {
    if (e instanceof Error && (e.message.includes('Acesso negado') || e.message.includes('não autenticado'))) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * POST /api/admin/vsl/projects
 * Cria projeto VSL. Body: name, slug, banca_id?, redirect_timer_seconds?, pixel_id?
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireVslAdmin(req);
    const body = await req.json().catch(() => ({})) as {
      name?: string;
      slug?: string;
      banca_id?: string | null;
      redirect_timer_seconds?: number;
      pixel_id?: string | null;
    };
    const { name, slug } = body;
    if (!name?.trim() || !slug?.trim()) {
      return errorResponse('name e slug são obrigatórios', 400);
    }
    const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!safeSlug) {
      return errorResponse('slug inválido', 400);
    }

    const { data: row, error } = await supabaseServiceRole
      .from('vsl_projects')
      .insert({
        name: name.trim(),
        slug: safeSlug,
        banca_id: body.banca_id ?? null,
        owner_user_id: userId,
        redirect_timer_seconds: body.redirect_timer_seconds ?? 5,
        pixel_id: body.pixel_id ?? null,
      })
      .select('id, name, slug, is_active, redirect_timer_seconds, banca_id, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      console.error('[admin/vsl/projects]', error.message);
      return errorResponse('Erro ao criar projeto', 500);
    }

    await supabaseServiceRole.from('redirect_slugs').insert({
      project_id: row.id,
      slug: safeSlug,
    });

    return successResponse(row);
  } catch (e: unknown) {
    if (e instanceof Error && (e.message.includes('Acesso negado') || e.message.includes('não autenticado'))) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
