import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserProfile, getSubordinates } from '@/lib/middleware/permissions';

/**
 * PUT /api/admin/flow-instances/[instanceId]
 * Atualiza uma instância de flow (principalmente para ativar/desativar).
 * Admin pode alterar qualquer flow_instance; outro usuário só a própria.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceId } = await params;
    const body = await req.json();
    const { is_active, instance_name, group_jid, settings_json } = body;

    const profile = await getUserProfile(userId);
    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';

    const { data: existing, error: checkError } = await supabaseServiceRole
      .from('flow_instances')
      .select('id, user_id')
      .eq('id', instanceId)
      .single();

    if (checkError || !existing) {
      return errorResponse('Instância não encontrada', 404);
    }

    const isOwner = existing.user_id === userId;
    let canEdit = isOwner || isAdmin;
    if (!canEdit && isDonoBanca) {
      const subs = await getSubordinates(userId);
      canEdit = [userId, ...subs.map((s) => s.id)].includes(existing.user_id);
    }
    if (!canEdit) {
      return errorResponse('Sem permissão para alterar esta ativação', 403);
    }

    // Prepara dados para atualização
    const updateData: any = {};
    if (is_active !== undefined) updateData.is_active = is_active;
    if (instance_name) updateData.instance_name = instance_name;
    if (group_jid) updateData.group_jid = group_jid;
    if (settings_json !== undefined) updateData.settings_json = settings_json;

    const { data: instance, error } = await supabaseServiceRole
      .from('flow_instances')
      .update(updateData)
      .eq('id', instanceId)
      .select(`
        *,
        flows:flow_id (
          id,
          name,
          description,
          type,
          status,
          graph_json
        )
      `)
      .single();

    if (error) {
      console.error('❌ [FLOW-INSTANCES] Erro ao atualizar instância:', error);
      return errorResponse('Erro ao atualizar instância de flow', 500);
    }

    return successResponse(instance, 'Instância atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/flow-instances/[instanceId]
 * Remove uma instância de flow. Admin pode remover qualquer uma.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceId } = await params;

    const profile = await getUserProfile(userId);
    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';

    const { data: existing, error: checkError } = await supabaseServiceRole
      .from('flow_instances')
      .select('id, user_id')
      .eq('id', instanceId)
      .single();

    if (checkError || !existing) {
      return errorResponse('Instância não encontrada', 404);
    }

    const isOwner = existing.user_id === userId;
    let canDelete = isOwner || isAdmin;
    if (!canDelete && isDonoBanca) {
      const subs = await getSubordinates(userId);
      canDelete = [userId, ...subs.map((s) => s.id)].includes(existing.user_id);
    }
    if (!canDelete) {
      return errorResponse('Sem permissão para remover esta ativação', 403);
    }

    const { error } = await supabaseServiceRole
      .from('flow_instances')
      .delete()
      .eq('id', instanceId);

    if (error) {
      console.error('❌ [FLOW-INSTANCES] Erro ao deletar instância:', error);
      return errorResponse('Erro ao deletar instância de flow', 500);
    }

    return successResponse(null, 'Instância removida com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

