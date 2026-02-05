import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PUT /api/ai-agents/flow-agents/[agentId]
 * Atualiza configuração de instância e grupo de um agente de flow
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { agentId } = await params;
    const body = await req.json();
    const { instance_id, group_jid, is_active } = body;

    // Verifica se o agente existe e se o flow foi criado por admin
    const { data: agent, error: agentError } = await supabaseServiceRole
      .from('whatsapp_group_agents')
      .select(`
        *,
        flows (
          id,
          user_id,
          created_by
        )
      `)
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      return errorResponse('Agente não encontrado', 404);
    }

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';

    const flow = agent.flows as any;
    if (!flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    // Se não for admin, verifica se o flow foi criado por admin
    if (!isAdmin) {
      // Busca se o created_by é um admin
      if (flow.created_by) {
        const { data: creator } = await supabaseServiceRole
          .from('profiles')
          .select('status')
          .eq('id', flow.created_by)
          .single();

        if (creator?.status !== 'admin') {
          return errorResponse('Acesso negado. Apenas agentes criados por admin podem ser configurados', 403);
        }
      } else {
        return errorResponse('Acesso negado. Apenas agentes criados por admin podem ser configurados', 403);
      }
    }

    // Valida instância (deve ser mestre e do usuário)
    if (instance_id) {
      const { data: instance, error: instanceError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, is_master, status')
        .eq('id', instance_id)
        .single();

      if (instanceError || !instance) {
        return errorResponse('Instância não encontrada', 404);
      }

      if (!instance.is_master) {
        return errorResponse('Apenas instâncias mestre podem ser usadas', 400);
      }

      if (instance.status !== 'ok') {
        return errorResponse('Instância deve estar conectada', 400);
      }
    }

    // Atualiza agente
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (instance_id !== undefined) {
      updateData.instance_id = instance_id || null;
    }

    if (group_jid !== undefined) {
      updateData.group_jid = group_jid || null;
    }

    if (is_active !== undefined) {
      updateData.is_active = is_active;
    }

    // Só ativa se tiver instância e grupo configurados
    if (updateData.is_active && (!updateData.instance_id && !instance_id) || (!updateData.group_jid && !group_jid)) {
      return errorResponse('Configure instância e grupo antes de ativar', 400);
    }

    const { data: updatedAgent, error: updateError } = await supabaseServiceRole
      .from('whatsapp_group_agents')
      .update(updateData)
      .eq('id', agentId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ [AI AGENTS] Erro ao atualizar agente:', updateError);
      return errorResponse('Erro ao atualizar agente', 500);
    }

    return successResponse(updatedAgent, 'Agente atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

