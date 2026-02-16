import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const WHATSAPP_INVITE_PREFIX = 'https://chat.whatsapp.com/';

/**
 * PATCH /api/admin/redirect/groups/[id]
 * Atualiza grupo: name?, invite_url?, weight_percent?, is_active?
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: group } = await supabaseServiceRole
      .from('redirect_groups')
      .select('project_id, invite_url')
      .eq('id', id)
      .single();
    if (!group) return errorResponse('Grupo não encontrado', 404);
    await requireVslProjectAccess(req, group.project_id);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) payload.name = body.name;
    if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);
    if (body.weight_percent !== undefined) {
      const w = Math.min(100, Math.max(0, Number(body.weight_percent)));
      payload.weight_percent = w;
    }
    if (body.invite_url !== undefined) {
      const url = String(body.invite_url).trim();
      if (!url.toLowerCase().startsWith(WHATSAPP_INVITE_PREFIX)) {
        return errorResponse('invite_url deve começar com https://chat.whatsapp.com/', 400);
      }
      payload.invite_url = url;
    }

    const { data, error } = await supabaseServiceRole
      .from('redirect_groups')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[admin/redirect/groups PATCH]', error.message);
      return errorResponse('Erro ao atualizar grupo', 500);
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
 * DELETE /api/admin/redirect/groups/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: group } = await supabaseServiceRole
      .from('redirect_groups')
      .select('project_id')
      .eq('id', id)
      .single();
    if (!group) return errorResponse('Grupo não encontrado', 404);
    await requireVslProjectAccess(req, group.project_id);

    await supabaseServiceRole.from('redirect_slug_groups').delete().eq('group_id', id);
    const { error } = await supabaseServiceRole.from('redirect_groups').delete().eq('id', id);
    if (error) {
      console.error('[admin/redirect/groups DELETE]', error.message);
      return errorResponse('Erro ao remover grupo', 500);
    }
    return successResponse({ deleted: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
