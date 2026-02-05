import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/ai-agents/config
 * Cria ou atualiza configuração de Agente IA para o usuário
 * Body: { ai_agent_id, instance_id, group_jid, is_active }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    const { ai_agent_id, instance_id, group_jid, is_active } = body;

    if (!ai_agent_id || !instance_id || !group_jid) {
      return errorResponse('ai_agent_id, instance_id e group_jid são obrigatórios', 400);
    }

    // Verifica se a instância pertence ao usuário e é mestre
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, user_id, is_master, status')
      .eq('id', instance_id)
      .eq('user_id', userId)
      .eq('is_master', true)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância mestre não encontrada ou não pertence ao usuário', 404);
    }

    // Verifica se o agente existe e está ativo
    const { data: agent, error: agentError } = await supabaseServiceRole
      .from('ai_agents')
      .select('id, enabled')
      .eq('id', ai_agent_id)
      .eq('enabled', true)
      .single();

    if (agentError || !agent) {
      return errorResponse('Agente IA não encontrado ou inativo', 404);
    }

    // Upsert configuração
    const { data: config, error } = await supabaseServiceRole
      .from('user_ai_agents')
      .upsert({
        user_id: userId,
        ai_agent_id,
        instance_id,
        group_jid,
        is_active: is_active !== undefined ? is_active : false,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,ai_agent_id,group_jid',
      })
      .select(`
        *,
        ai_agents (*),
        evolution_instances (id, instance_name, status)
      `)
      .single();

    if (error) {
      console.error('❌ [AI AGENTS CONFIG] Erro ao salvar configuração:', error);
      return errorResponse('Erro ao salvar configuração', 500);
    }

    return successResponse(config, 'Configuração salva com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao salvar configuração', 401);
  }
}

/**
 * DELETE /api/ai-agents/config
 * Remove configuração de Agente IA
 * Query: ?id=uuid (id da configuração user_ai_agents)
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const configId = searchParams.get('id');

    if (!configId) {
      return errorResponse('id é obrigatório', 400);
    }

    // Verifica se a configuração pertence ao usuário
    const { data: config, error: checkError } = await supabaseServiceRole
      .from('user_ai_agents')
      .select('id')
      .eq('id', configId)
      .eq('user_id', userId)
      .single();

    if (checkError || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const { error } = await supabaseServiceRole
      .from('user_ai_agents')
      .delete()
      .eq('id', configId);

    if (error) {
      return errorResponse('Erro ao remover configuração', 500);
    }

    return successResponse(null, 'Configuração removida com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao remover configuração', 401);
  }
}

