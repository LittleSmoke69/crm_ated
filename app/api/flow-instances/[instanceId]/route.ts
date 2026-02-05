import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

/**
 * PUT /api/flow-instances/[instanceId]
 * Atualiza uma instância de flow (gerente/dono de banca)
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceId } = await params;
    const body = await req.json();
    const { is_active, instance_name, group_jid, settings_json } = body;

    // Verifica se a instância pertence ao usuário
    const { data: existing, error: checkError } = await supabaseServiceRole
      .from('flow_instances')
      .select('id, instance_name, user_id')
      .eq('id', instanceId)
      .eq('user_id', userId)
      .single();

    if (checkError || !existing) {
      return errorResponse('Instância não encontrada ou sem permissão', 404);
    }

    // Se está alterando a instância, verifica acesso
    if (instance_name && instance_name !== existing.instance_name) {
      const hasAccess = await checkInstanceAccess(userId, instance_name);
      if (!hasAccess) {
        return errorResponse('Acesso negado. Você não tem permissão para usar esta instância.', 403);
      }
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
 * DELETE /api/flow-instances/[instanceId]
 * Remove uma instância de flow (gerente/dono de banca)
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceId } = await params;

    // Verifica se a instância pertence ao usuário
    const { data: existing, error: checkError } = await supabaseServiceRole
      .from('flow_instances')
      .select('id')
      .eq('id', instanceId)
      .eq('user_id', userId)
      .single();

    if (checkError || !existing) {
      return errorResponse('Instância não encontrada ou sem permissão', 404);
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
