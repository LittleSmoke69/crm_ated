import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Sincroniza agentes IA baseados em nodes Agent IA do flow
 * Apenas admin pode criar agentes automaticamente
 */
async function syncFlowAgents(flowId: string, graphJson: any, userId: string) {
  try {
    // Verifica se o usuário é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || profile.status !== 'super_admin') {
      // Apenas SuperAdmin pode criar agentes automaticamente via flow
      return;
    }

    if (!graphJson?.nodes || !Array.isArray(graphJson.nodes)) {
      console.log('⚠️ [FLOWS] Graph JSON sem nodes válidos');
      return;
    }

    // Encontra todos os nodes Agent IA
    const agentNodes = graphJson.nodes.filter((node: any) => node.type === 'agentIA');
    console.log(`🔍 [FLOWS] Encontrados ${agentNodes.length} nodes Agent IA no flow ${flowId}`);

    if (agentNodes.length === 0) {
      console.log('⚠️ [FLOWS] Nenhum node Agent IA encontrado, removendo agentes vinculados');
      // Se não há nodes Agent IA, remove agentes vinculados a este flow (se houver)
      await supabaseServiceRole
        .from('whatsapp_group_agents')
        .update({ flow_id: null })
        .eq('flow_id', flowId);
      return;
    }

    // Para cada node Agent IA, cria/atualiza um agente
    for (const node of agentNodes) {
      const config = node.data?.config || {};
      const systemPrompt = config.system_prompt || '';
      
      console.log(`🔍 [FLOWS] Processando node ${node.id}, tem prompt: ${!!systemPrompt}, prompt length: ${systemPrompt.length}`);
      
      if (!systemPrompt) {
        console.log(`⚠️ [FLOWS] Node ${node.id} sem prompt, pulando...`);
        continue; // Pula se não tem prompt configurado
      }

      // Cria ou atualiza agente vinculado ao flow
      const agentName = config.label || node.data?.label || `Agente IA - ${flowId.substring(0, 8)}`;
      
      console.log(`📝 [FLOWS] Criando/atualizando agente: ${agentName} para flow ${flowId}, node ${node.id}`);
      
      // Busca se já existe agente para este flow e node
      const { data: existingAgent } = await supabaseServiceRole
        .from('whatsapp_group_agents')
        .select('id')
        .eq('flow_id', flowId)
        .eq('node_id', node.id)
        .maybeSingle();

      const agentData: any = {
        flow_id: flowId,
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
        is_active: false, // Por padrão inativo até configurar instância e grupo
        group_jid: null, // Será preenchido quando usuário configurar
        instance_id: null, // Será preenchido quando usuário configurar
      };

      if (existingAgent) {
        console.log(`🔄 [FLOWS] Atualizando agente existente: ${existingAgent.id}`);
        // Atualiza agente existente (preserva instance_id e group_jid se já configurados)
        const { data: currentAgent } = await supabaseServiceRole
          .from('whatsapp_group_agents')
          .select('instance_id, group_jid')
          .eq('id', existingAgent.id)
          .single();

        const { error: updateError } = await supabaseServiceRole
          .from('whatsapp_group_agents')
          .update({
            ...agentData,
            // Preserva configurações de instância e grupo se já existirem
            instance_id: currentAgent?.instance_id || null,
            group_jid: currentAgent?.group_jid || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingAgent.id);

        if (updateError) {
          console.error(`❌ [FLOWS] Erro ao atualizar agente ${existingAgent.id}:`, updateError);
        } else {
          console.log(`✅ [FLOWS] Agente ${existingAgent.id} atualizado com sucesso`);
        }
      } else {
        console.log(`➕ [FLOWS] Criando novo agente para flow ${flowId}`);
        const { data: newAgent, error: insertError } = await supabaseServiceRole
          .from('whatsapp_group_agents')
          .insert(agentData)
          .select()
          .single();

        if (insertError) {
          console.error(`❌ [FLOWS] Erro ao criar agente:`, insertError);
          console.error(`❌ [FLOWS] Dados do agente:`, JSON.stringify(agentData, null, 2));
        } else {
          console.log(`✅ [FLOWS] Agente criado com sucesso:`, newAgent?.id);
        }
      }
    }
  } catch (err: any) {
    console.error('❌ [FLOWS] Erro ao sincronizar agentes:', err);
    // Não falha o salvamento do flow se houver erro ao sincronizar agentes
  }
}

/**
 * GET /api/admin/flows/[flowId]
 * Busca um flow específico
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireSuperAdmin(req);
    const { flowId } = await params;

    const { data: flow, error } = await supabaseServiceRole
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (error || !flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    return successResponse(flow);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PUT /api/admin/flows/[flowId]
 * Atualiza um flow
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireSuperAdmin(req);
    const { flowId } = await params;
    const body = await req.json();

    // Verifica se o flow pertence ao usuário
    const { data: existingFlow } = await supabaseServiceRole
      .from('flows')
      .select('id')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (!existingFlow) {
      return errorResponse('Flow não encontrado', 404);
    }

    // Valida graph_json se fornecido
    if (body.graph_json) {
      if (!body.graph_json.nodes || !body.graph_json.edges || !Array.isArray(body.graph_json.nodes)) {
        return errorResponse('graph_json deve ter nodes e edges como arrays', 400);
      }
    }

    const { data: flow, error } = await supabaseServiceRole
      .from('flows')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flowId)
      .select()
      .single();

    if (error) {
      console.error('❌ [FLOWS] Erro ao atualizar flow:', error);
      return errorResponse('Erro ao atualizar flow', 500);
    }

    // Detecta nodes Agent IA e cria/atualiza agentes
    if (body.graph_json) {
      console.log('🔄 [FLOWS] Sincronizando agentes para flow atualizado:', flowId);
      console.log('🔄 [FLOWS] Graph JSON recebido:', JSON.stringify(body.graph_json, null, 2));
      await syncFlowAgents(flowId, body.graph_json, userId);
      console.log('✅ [FLOWS] Sincronização de agentes concluída para flow atualizado');
    } else {
      console.log('⚠️ [FLOWS] Graph JSON não fornecido no update');
    }

    return successResponse(flow, 'Flow atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/flows/[flowId]
 * Deleta um flow
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireSuperAdmin(req);
    const { flowId } = await params;

    // Verifica se o flow pertence ao usuário
    const { data: existingFlow } = await supabaseServiceRole
      .from('flows')
      .select('id')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (!existingFlow) {
      return errorResponse('Flow não encontrado', 404);
    }

    const { error } = await supabaseServiceRole
      .from('flows')
      .delete()
      .eq('id', flowId);

    if (error) {
      console.error('❌ [FLOWS] Erro ao deletar flow:', error);
      return errorResponse('Erro ao deletar flow', 500);
    }

    return successResponse(null, 'Flow deletado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

