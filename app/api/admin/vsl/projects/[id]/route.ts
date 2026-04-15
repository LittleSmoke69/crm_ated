import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

function normalizeVslSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

/**
 * GET /api/admin/vsl/projects/[id]
 * Retorna projeto (sem capi_access_token).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug, is_active, redirect_timer_seconds, logo_path, pixel_id, banca_id, meta_graph_base_url, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse('Projeto não encontrado', 404);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * PATCH /api/admin/vsl/projects/[id]
 * Atualiza projeto. Body: name?, slug?, is_active?, redirect_timer_seconds?, logo_path?, pixel_id?, meta_graph_base_url?.
 * capi_access_token só pode ser setado por endpoint dedicado (nunca retornado).
 * Ao mudar slug: sincroniza redirect_slugs (linha canônica) e vsl_pages.redirect_slug quando igual ao slug antigo.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = ['name', 'is_active', 'redirect_timer_seconds', 'logo_path', 'pixel_id', 'meta_graph_base_url', 'banca_id'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (body[k] !== undefined) payload[k] = body[k];
    }

    const { data: current, error: curErr } = await supabaseServiceRole
      .from('vsl_projects')
      .select('slug')
      .eq('id', id)
      .single();
    if (curErr || !current?.slug) {
      return errorResponse('Projeto não encontrado', 404);
    }
    const oldSlug = current.slug as string;

    if (body.slug !== undefined) {
      const newSlug = normalizeVslSlug(String(body.slug));
      if (!newSlug) {
        return errorResponse('slug inválido', 400);
      }
      if (newSlug !== oldSlug) {
        const { data: dup } = await supabaseServiceRole
          .from('vsl_projects')
          .select('id')
          .eq('slug', newSlug)
          .neq('id', id)
          .maybeSingle();
        if (dup?.id) {
          return errorResponse('Slug já existe', 400);
        }

        const { error: rsErr } = await supabaseServiceRole
          .from('redirect_slugs')
          .update({ slug: newSlug })
          .eq('project_id', id)
          .eq('slug', oldSlug);
        if (rsErr) {
          if (rsErr.code === '23505') {
            return errorResponse('Slug de redirect já está em uso', 400);
          }
          console.error('[admin/vsl/projects PATCH] redirect_slugs', rsErr.message);
          return errorResponse('Erro ao atualizar slug do redirect', 500);
        }

        const { data: rsCanonical } = await supabaseServiceRole
          .from('redirect_slugs')
          .select('id')
          .eq('project_id', id)
          .eq('slug', newSlug)
          .maybeSingle();
        if (!rsCanonical?.id) {
          const { error: insRsErr } = await supabaseServiceRole.from('redirect_slugs').insert({
            project_id: id,
            slug: newSlug,
            is_active: true,
          });
          if (insRsErr) {
            if (insRsErr.code === '23505') {
              return errorResponse('Slug de redirect já está em uso', 400);
            }
            console.error('[admin/vsl/projects PATCH] redirect_slugs insert', insRsErr.message);
            return errorResponse('Erro ao criar slug do redirect', 500);
          }
        }

        const { error: pagesErr } = await supabaseServiceRole
          .from('vsl_pages')
          .update({ redirect_slug: newSlug, updated_at: new Date().toISOString() })
          .eq('project_id', id)
          .eq('redirect_slug', oldSlug);
        if (pagesErr) {
          console.error('[admin/vsl/projects PATCH] vsl_pages', pagesErr.message);
          return errorResponse('Erro ao atualizar páginas VSL vinculadas ao slug', 500);
        }

        payload.slug = newSlug;
      }
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .update(payload)
      .eq('id', id)
      .select('id, name, slug, is_active, redirect_timer_seconds, logo_path, pixel_id, banca_id, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return errorResponse('Slug já existe', 400);
      }
      console.error('[admin/vsl/projects PATCH]', error.message);
      return errorResponse('Erro ao atualizar projeto', 500);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * DELETE /api/admin/vsl/projects/[id]
 * Remove o projeto e dados relacionados (CASCADE no banco).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const { error } = await supabaseServiceRole.from('vsl_projects').delete().eq('id', id);
    if (error) {
      console.error('[admin/vsl/projects DELETE]', error.message);
      return errorResponse('Erro ao remover projeto', 500);
    }
    return successResponse({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
