import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

// DELETE /api/crm/columns/[id] — remove uma coluna (os clientes nela voltam ao 1º estágio)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const { error } = await supabaseServiceRole.from('crm_columns').delete().eq('id', id);
    if (error) return errorResponse(`Erro ao remover coluna: ${error.message}`, 500);
    return successResponse({ ok: true });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// PATCH /api/crm/columns/[id] — renomeia / troca cor / reordena
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.color === 'string' && body.color) patch.color = body.color;
    if (Number.isFinite(body.sort_order)) patch.sort_order = Number(body.sort_order);
    if (!Object.keys(patch).length) return errorResponse('Nada para atualizar.', 400);
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseServiceRole
      .from('crm_columns')
      .update(patch)
      .eq('id', id)
      .select('id, key, title, color, sort_order')
      .single();
    if (error) return errorResponse(`Erro ao atualizar coluna: ${error.message}`, 500);
    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err);
  }
}
