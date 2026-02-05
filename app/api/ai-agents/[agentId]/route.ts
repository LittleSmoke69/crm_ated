import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PUT /api/ai-agents/[agentId]
 * Atualiza configuração do usuário para um agente IA
 * Body: { instance_id?, group_jid?, is_active? }
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

    // Verifica se o agente existe e está habilitado
    const { data: agent, error: agentError } = await supabaseServiceRole
      .from('ai_agents')
      .select('id, enabled')
      .eq('id', agentId)
      .eq('enabled', true)
      .single();

    if (agentError || !agent) {
      return errorResponse('Agente não encontrado ou não habilitado', 404);
    }

    // Se estiver ativando, valida que tem instância mestre e grupo
    if (is_active === true) {
      if (!instance_id) {
        return errorResponse('instance_id é obrigatório para ativar o agente', 400);
      }

      // Verifica se a instância é mestre e pertence ao usuário
      const { data: instance } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, user_id, is_master, status')
        .eq('id', instance_id)
        .eq('is_master', true)
        .eq('is_active', true)
        .single();

      if (!instance || instance.user_id !== userId) {
        return errorResponse('Instância mestre não encontrada ou não pertence ao usuário', 400);
      }

      if (instance.status !== 'ok') {
        return errorResponse('Instância mestre deve estar conectada para ativar o agente', 400);
      }

      if (!group_jid) {
        return errorResponse('group_jid é obrigatório para ativar o agente', 400);
      }
    }

    // Busca configuração existente
    const { data: existingConfig } = await supabaseServiceRole
      .from('user_ai_agents')
      .select('id')
      .eq('user_id', userId)
      .eq('ai_agent_id', agentId)
      .eq('group_jid', group_jid || '')
      .maybeSingle();

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (instance_id !== undefined) updateData.instance_id = instance_id || null;
    if (group_jid !== undefined) updateData.group_jid = group_jid || null;
    if (is_active !== undefined) updateData.is_active = is_active === true;

    let result;
    if (existingConfig) {
      // Atualiza configuração existente
      const { data, error } = await supabaseServiceRole
        .from('user_ai_agents')
        .update(updateData)
        .eq('id', existingConfig.id)
        .select()
        .single();

      if (error) {
        return errorResponse('Erro ao atualizar configuração', 500);
      }
      result = data;
    } else {
      // Cria nova configuração
      const { data, error } = await supabaseServiceRole
        .from('user_ai_agents')
        .insert({
          user_id: userId,
          ai_agent_id: agentId,
          ...updateData,
        })
        .select()
        .single();

      if (error) {
        return errorResponse('Erro ao criar configuração', 500);
      }
      result = data;
    }

    return successResponse(result, 'Configuração atualizada com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao atualizar configuração', 401);
  }
}

