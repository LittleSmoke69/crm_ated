import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/flows/sync-agents
 * Sincroniza agentes para todos os flows criados por admin que têm nodes Agent IA
 * Útil para criar agentes de flows que foram criados antes da implementação
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || profile.status !== 'super_admin') {
      return errorResponse('Apenas SuperAdmin pode sincronizar agentes', 403);
    }

    // Busca todos os flows criados por SuperAdmin
    const { data: superAdmins } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('status', 'super_admin');

    if (!superAdmins || superAdmins.length === 0) {
      return successResponse({ synced: 0, message: 'Nenhum SuperAdmin encontrado' });
    }

    const adminIds = superAdmins.map(a => a.id);

    const { data: adminFlows, error: flowsError } = await supabaseServiceRole
      .from('flows')
      .select('id, name, graph_json, created_by')
      .in('created_by', adminIds)
      .not('graph_json', 'is', null);

    if (flowsError) {
      console.error('❌ [SYNC AGENTS] Erro ao buscar flows:', flowsError);
      return errorResponse('Erro ao buscar flows', 500);
    }

    if (!adminFlows || adminFlows.length === 0) {
      return successResponse({ synced: 0, message: 'Nenhum flow encontrado' });
    }

    console.log(`🔄 [SYNC AGENTS] Sincronizando ${adminFlows.length} flows...`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const flow of adminFlows) {
      try {
        const graphJson = flow.graph_json as any;
        
        if (!graphJson?.nodes || !Array.isArray(graphJson.nodes)) {
          continue;
        }

        // Encontra nodes Agent IA
        const agentNodes = graphJson.nodes.filter((node: any) => node.type === 'agentIA');

        if (agentNodes.length === 0) {
          continue;
        }

        console.log(`🔍 [SYNC AGENTS] Flow ${flow.name} tem ${agentNodes.length} nodes Agent IA`);

        // Para cada node Agent IA, cria/atualiza um agente
        for (const node of agentNodes) {
          const config = node.data?.config || {};
          const systemPrompt = config.system_prompt || '';
          
          if (!systemPrompt) {
            console.log(`⚠️ [SYNC AGENTS] Node ${node.id} sem prompt, pulando...`);
            continue;
          }

          const agentName = config.label || node.data?.label || `Agente IA - ${flow.id.substring(0, 8)}`;
          
          // Verifica se já existe
          const { data: existingAgent } = await supabaseServiceRole
            .from('whatsapp_group_agents')
            .select('id')
            .eq('flow_id', flow.id)
            .eq('node_id', node.id)
            .maybeSingle();

          const agentData: any = {
            flow_id: flow.id,
            node_id: node.id,
            agent_name: agentName,
            system_prompt: systemPrompt,
            persona_tone: config.persona_tone || 'gentil',
            persona_role: config.persona_role || 'consultor',
            objective: config.objective || 'levar para deposito',
            max_replies_per_window: config.max_replies_per_window || 2,
            window_seconds: config.window_seconds || 300,
            user_cooldown_seconds: config.user_cooldown_seconds || 600,
            only_reply_if_question: config.only_reply_if_question !== false,
            only_reply_if_mentioned: config.only_reply_if_mentioned === true,
            keywords: Array.isArray(config.keywords) ? config.keywords : (typeof config.keywords === 'string' ? config.keywords.split(',').map((k: string) => k.trim()).filter((k: string) => k) : []),
            is_active: false,
            group_jid: null,
            instance_id: null,
          };

          if (existingAgent) {
            // Atualiza existente
            const { data: currentAgent } = await supabaseServiceRole
              .from('whatsapp_group_agents')
              .select('instance_id, group_jid')
              .eq('id', existingAgent.id)
              .single();

            await supabaseServiceRole
              .from('whatsapp_group_agents')
              .update({
                ...agentData,
                instance_id: currentAgent?.instance_id || null,
                group_jid: currentAgent?.group_jid || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingAgent.id);
            
            console.log(`✅ [SYNC AGENTS] Agente ${existingAgent.id} atualizado`);
          } else {
            // Cria novo
            const { data: newAgent, error: insertError } = await supabaseServiceRole
              .from('whatsapp_group_agents')
              .insert(agentData)
              .select()
              .single();

            if (insertError) {
              console.error(`❌ [SYNC AGENTS] Erro ao criar agente:`, insertError);
              errorCount++;
            } else {
              console.log(`✅ [SYNC AGENTS] Agente ${newAgent.id} criado`);
              syncedCount++;
            }
          }
        }
      } catch (err: any) {
        console.error(`❌ [SYNC AGENTS] Erro ao processar flow ${flow.id}:`, err);
        errorCount++;
      }
    }

    return successResponse({
      synced: syncedCount,
      errors: errorCount,
      total: adminFlows.length,
      message: `Sincronização concluída: ${syncedCount} agente(s) criado(s)/atualizado(s)`
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

