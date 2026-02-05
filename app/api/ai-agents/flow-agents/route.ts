import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/ai-agents/flow-agents
 * Lista agentes IA criados a partir de flows
 * - Admin vê todos os agentes criados por admin
 * - Outros usuários veem apenas agentes criados por admin (não seus próprios)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';

    // Se não for admin, mostra apenas agentes criados por admin
    let flowIdsFilter: string[] | null = null;
    
    if (!isAdmin) {
      // Busca usuários admin
      const { data: admins } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('status', 'admin');

      if (!admins || admins.length === 0) {
        console.log('❌ [FLOW AGENTS] Nenhum admin encontrado');
        return successResponse([]);
      }

      const adminIds = admins.map(a => a.id);
      console.log('✅ [FLOW AGENTS] Admin IDs:', adminIds);

      // Busca flows criados por admin
      const { data: adminFlows, error: flowsError } = await supabaseServiceRole
        .from('flows')
        .select('id, name, created_by, status')
        .in('created_by', adminIds);

      if (flowsError) {
        console.error('❌ [FLOW AGENTS] Erro ao buscar flows de admin:', flowsError);
        return successResponse([]);
      }

      console.log('📋 [FLOW AGENTS] Flows encontrados:', adminFlows?.length || 0);
      if (adminFlows && adminFlows.length > 0) {
        console.log('📋 [FLOW AGENTS] Detalhes dos flows:', adminFlows);
        flowIdsFilter = adminFlows.map(f => f.id);
        console.log('✅ [FLOW AGENTS] Flow IDs de admin:', flowIdsFilter);
      } else {
        console.log('⚠️ [FLOW AGENTS] Nenhum flow criado por admin encontrado');
        // Não retorna vazio ainda - vamos verificar se há agentes mesmo sem flows
        // return successResponse([]);
      }
    }

    // Constrói query base - busca todos os agentes com flow_id
    let query = supabaseServiceRole
      .from('whatsapp_group_agents')
      .select(`
        *,
        flows!inner (
          id,
          name,
          description,
          status,
          user_id,
          created_by
        ),
        evolution_instances (
          id,
          instance_name,
          status
        )
      `)
      .not('flow_id', 'is', null);

    // Aplica filtro de flows de admin se necessário
    if (flowIdsFilter && flowIdsFilter.length > 0) {
      query = query.in('flow_id', flowIdsFilter);
      console.log('🔍 [FLOW AGENTS] Aplicando filtro de flow_ids:', flowIdsFilter);
    } else if (!isAdmin) {
      // Se não há flows de admin e não é admin, retorna vazio
      console.log('⚠️ [FLOW AGENTS] Sem flows de admin para filtrar');
      return successResponse([]);
    }

    const { data: agents, error } = await query.order('created_at', { ascending: false });
    
    console.log('📦 [FLOW AGENTS] Agentes brutos retornados:', agents?.length || 0);
    if (agents && agents.length > 0) {
      console.log('📦 [FLOW AGENTS] Primeiro agente exemplo:', JSON.stringify(agents[0], null, 2));
    }

    if (error) {
      console.error('❌ [FLOW AGENTS] Erro na query:', error);
      return errorResponse('Erro ao buscar agentes', 500);
    }

    // Filtra agentes que têm flow válido (pode ser null se o flow foi deletado)
    const validAgents = (agents || []).filter((agent: any) => {
      const flow = agent.flows;
      if (!flow) {
        console.log('⚠️ [FLOW AGENTS] Agente sem flow:', agent.id);
        return false;
      }
      
      // Se não for admin, verifica se o flow foi criado por admin
      if (!isAdmin) {
        const isValid = flowIdsFilter && flowIdsFilter.includes(flow.id);
        if (!isValid) {
          console.log('⚠️ [FLOW AGENTS] Flow não é de admin:', flow.id, flow.created_by);
        }
        return isValid;
      }
      
      return true;
    });

    console.log('✅ [FLOW AGENTS] Agentes válidos encontrados:', validAgents.length, 'de', agents?.length || 0);

    return successResponse(validAgents);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

