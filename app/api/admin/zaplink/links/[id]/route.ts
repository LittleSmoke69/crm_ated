/**
 * GET /api/admin/zaplink/links/[id] - Busca link
 * PUT /api/admin/zaplink/links/[id] - Atualiza link
 * DELETE /api/admin/zaplink/links/[id] - Remove link
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(_req);
    const { id } = await params;

    const { data, error } = await supabaseServiceRole
      .from('zaplink_links')
      .select('id, slug, target_url, title, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse('Link não encontrado', 404);
    }

    return successResponse(data);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : undefined;
    const target_url = typeof body.target_url === 'string' ? body.target_url.trim() : undefined;
    const title = typeof body.title === 'string' ? body.title.trim() || null : undefined;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (slug !== undefined) updates.slug = slug;
    if (target_url !== undefined) updates.target_url = target_url;
    if (title !== undefined) updates.title = title;

    const { data, error } = await supabaseServiceRole
      .from('zaplink_links')
      .update(updates)
      .eq('id', id)
      .select('id, slug, target_url, title, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      return errorResponse(`Erro ao atualizar: ${error.message}`, 500);
    }

    return successResponse(data, 'Link atualizado');
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(_req);
    const { id } = await params;

    const { error } = await supabaseServiceRole
      .from('zaplink_links')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao remover: ${error.message}`, 500);
    }

    return successResponse({ deleted: true }, 'Link removido');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
