import { NextRequest } from 'next/server';
import {
  assertConsultantAllowedForVslUser,
  isMissingConsultantColumnError,
  validateConsultantUserId,
} from '@/lib/admin/redirect-group-consultant';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { equalWeightsForRedirectGroups } from '@/lib/vsl/redirect-weight';

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
    const { userId, profile } = await requireVslProjectAccess(req, group.project_id);

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
    if (body.consultant_user_id !== undefined) {
      const chk = await validateConsultantUserId(body.consultant_user_id);
      if (!chk.ok) return errorResponse(chk.message, 400);
      const consultantGate = await assertConsultantAllowedForVslUser(chk.id, profile, userId);
      if (!consultantGate.ok) return errorResponse(consultantGate.message, 400);
      payload.consultant_user_id = chk.id;
    }

    let { data, error } = await supabaseServiceRole
      .from('redirect_groups')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error && isMissingConsultantColumnError(error) && payload.consultant_user_id !== undefined) {
      console.error('[admin/redirect/groups PATCH] Migração add_redirect_group_consultant.sql pendente.');
      return errorResponse(
        'Migração pendente: aplique migrations/add_redirect_group_consultant.sql para vincular consultores aos grupos.',
        500
      );
    }

    if (error) {
      console.error('[admin/redirect/groups PATCH]', error.message);
      return errorResponse('Erro ao atualizar grupo', 500);
    }

    /** Ao mudar ativo/inativo: redistribui % igualmente entre todos os grupos ativos do projeto (inativos = 0%). */
    let weightsByGroup: Record<string, number> | undefined;
    if (body.is_active !== undefined && data && group.project_id) {
      const { data: allRows, error: listErr } = await supabaseServiceRole
        .from('redirect_groups')
        .select('id, is_active')
        .eq('project_id', group.project_id)
        .order('name');
      if (listErr) {
        console.error('[admin/redirect/groups PATCH] list for redistribute', listErr.message);
        return errorResponse('Grupo atualizado, mas falhou ao redistribuir %. Recarregue a página.', 500);
      }
      const updates = equalWeightsForRedirectGroups((allRows ?? []) as { id: string; is_active: boolean }[]);
      const now = new Date().toISOString();
      for (const u of updates) {
        const { error: wErr } = await supabaseServiceRole
          .from('redirect_groups')
          .update({ weight_percent: u.weight_percent, updated_at: now })
          .eq('id', u.id);
        if (wErr) {
          console.error('[admin/redirect/groups PATCH] weight update', u.id, wErr.message);
          return errorResponse('Grupo atualizado, mas falhou ao redistribuir %. Recarregue a página.', 500);
        }
      }
      weightsByGroup = Object.fromEntries(updates.map((u) => [u.id, u.weight_percent]));
      const { data: refreshed } = await supabaseServiceRole.from('redirect_groups').select().eq('id', id).single();
      if (refreshed) data = refreshed;
    }

    if (weightsByGroup) {
      const activeCount = Object.values(weightsByGroup).filter((p) => p > 0).length;
      return successResponse(data, { meta: { weights_by_group: weightsByGroup, active_groups: activeCount } });
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
