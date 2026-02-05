import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/ai-agents
 * Lista agentes IA disponíveis para o usuário (apenas os habilitados pelo admin)
 * Retorna também as configurações do usuário para cada agente
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Busca agentes habilitados pelo admin
    const { data: agents, error: agentsError } = await supabaseServiceRole
      .from('ai_agents')
      .select('*')
      .eq('enabled', true)
      .order('created_at', { ascending: false });

    if (agentsError) {
      console.error('❌ [AI AGENTS] Erro ao buscar agentes:', agentsError);
      return errorResponse('Erro ao buscar agentes', 500);
    }

    // Busca configurações do usuário para cada agente
    const { data: userConfigs, error: configsError } = await supabaseServiceRole
      .from('user_ai_agents')
      .select(`
        *,
        evolution_instances (id, instance_name, status)
      `)
      .eq('user_id', userId);

    if (configsError) {
      console.error('❌ [AI AGENTS] Erro ao buscar configurações:', configsError);
    }

    // Mapeia configurações por agente
    const configsMap = new Map();
    (userConfigs || []).forEach((config: any) => {
      if (!configsMap.has(config.ai_agent_id)) {
        configsMap.set(config.ai_agent_id, []);
      }
      configsMap.get(config.ai_agent_id).push(config);
    });

    // Combina agentes disponíveis com configurações do usuário
    const agentsWithConfigs = (agents || []).map((agent: any) => ({
      ...agent,
      user_configs: configsMap.get(agent.id) || [],
    }));

    return successResponse(agentsWithConfigs);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar agentes', 401);
  }
}

/**
 * PUT /api/ai-agents/[agentId]
 * Atualiza configuração do usuário para um agente IA
 * Body: { instance_id?, group_jid?, is_active? }
 */
