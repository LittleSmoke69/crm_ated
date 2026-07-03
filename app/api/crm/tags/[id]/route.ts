import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

// PATCH /api/crm/tags/[id] — renomeia / troca cor / define coluna-alvo (automação)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    await requireStatus(req, ['super_admin', 'admin']);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim();
    if (typeof body.color === 'string') {
      if (!/^#[0-9A-Fa-f]{6}$/.test(body.color)) return errorResponse('Cor inválida (ex: #E86A24).', 400);
      patch.color = body.color.toUpperCase();
    }
    // move_to_column_key: string define automação; null/'' remove.
    if ('move_to_column_key' in body) {
      patch.move_to_column_key = typeof body.move_to_column_key === 'string' && body.move_to_column_key ? body.move_to_column_key : null;
    }
    if (!Object.keys(patch).length) return errorResponse('Nada para atualizar.', 400);
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseServiceRole.from('crm_tags').update(patch).eq('id', id).select().single();
    if (error) {
      if (error.code === '23505') return errorResponse('Uma etiqueta com este nome já existe.', 400);
      return errorResponse(`Erro ao atualizar etiqueta: ${error.message}`, 500);
    }
    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// DELETE /api/crm/tags/[id] — remove a etiqueta (crm_lead_tags cascateia)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    await requireStatus(req, ['super_admin', 'admin']);
    const { id } = await params;
    const { error } = await supabaseServiceRole.from('crm_tags').delete().eq('id', id);
    if (error) return errorResponse(`Erro ao remover etiqueta: ${error.message}`, 500);
    return successResponse({ ok: true });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
