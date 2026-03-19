/**
 * GET /api/admin/zaplink/forms/[id] - Busca formulário
 * PUT /api/admin/zaplink/forms/[id] - Atualiza formulário
 * DELETE /api/admin/zaplink/forms/[id] - Remove formulário
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
      .from('zaplink_forms')
      .select('id, slug, name, form_type, gestor_trafego_user_id, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse('Formulário não encontrado', 404);
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
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const formType = body.form_type === 'influenciador' ? 'influenciador' : body.form_type === 'consultor' ? 'consultor' : undefined;
    const gestorTrafegoUserId = body.gestor_trafego_user_id === null || body.gestor_trafego_user_id === '' ? null : (typeof body.gestor_trafego_user_id === 'string' ? body.gestor_trafego_user_id.trim() : undefined);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (slug !== undefined) updates.slug = slug;
    if (name !== undefined) updates.name = name;
    if (formType !== undefined) updates.form_type = formType;
    if (gestorTrafegoUserId !== undefined) updates.gestor_trafego_user_id = gestorTrafegoUserId || null;

    const { data, error } = await supabaseServiceRole
      .from('zaplink_forms')
      .update(updates)
      .eq('id', id)
      .select('id, slug, name, form_type, gestor_trafego_user_id, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      return errorResponse(`Erro ao atualizar: ${error.message}`, 500);
    }

    return successResponse(data, 'Formulário atualizado');
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
      .from('zaplink_forms')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao remover: ${error.message}`, 500);
    }

    return successResponse({ deleted: true }, 'Formulário removido');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
