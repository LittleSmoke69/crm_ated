import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/flows/[flowId]/debug
 * Debug: Verifica se o flow tem nodes Agent IA e se os agentes foram criados
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { flowId } = await params;

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || profile.status !== 'super_admin') {
      return errorResponse('Apenas SuperAdmin pode acessar', 403);
    }

    // Busca o flow
    const { data: flow, error: flowError } = await supabaseServiceRole
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    const graphJson = flow.graph_json as any;
    const nodes = graphJson?.nodes || [];
    const agentNodes = nodes.filter((n: any) => n.type === 'agentIA');

    // Busca agentes criados para este flow
    const { data: agents, error: agentsError } = await supabaseServiceRole
      .from('whatsapp_group_agents')
      .select('*')
      .eq('flow_id', flowId);

    return successResponse({
      flow: {
        id: flow.id,
        name: flow.name,
        created_by: flow.created_by,
        status: flow.status,
      },
      graph: {
        totalNodes: nodes.length,
        agentNodes: agentNodes.length,
        agentNodesDetails: agentNodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          hasConfig: !!n.data?.config,
          hasSystemPrompt: !!n.data?.config?.system_prompt,
          systemPromptLength: n.data?.config?.system_prompt?.length || 0,
          config: n.data?.config,
        })),
      },
      agents: {
        count: agents?.length || 0,
        agents: agents || [],
      },
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

