import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';

/**
 * POST /api/admin/flows/executions/[executionId]/re-execute
 * Re-executa um flow usando o mesmo evento da execução anterior
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { executionId } = await params;

    // Busca a execução (qualquer user_id; o dono do flow pode re-executar)
    const { data: execution, error: execError } = await supabaseServiceRole
      .from('flow_executions')
      .select('id, flow_id, trigger_event_id')
      .eq('id', executionId)
      .single();

    if (execError || !execution) {
      return errorResponse('Execução não encontrada', 404);
    }

    if (!execution.trigger_event_id) {
      return errorResponse('Execução não possui evento associado para re-executar', 400);
    }

    // Verifica se o flow existe, pertence ao usuário e está ativo
    const { data: flow, error: flowError } = await supabaseServiceRole
      .from('flows')
      .select('id, status')
      .eq('id', execution.flow_id)
      .eq('user_id', userId)
      .single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    if (flow.status !== 'active') {
      return errorResponse('Flow não está ativo. Ative o flow antes de re-executar', 400);
    }

    // Re-executa o flow com o mesmo evento
    const newExecutionId = await flowExecutorService.executeFlow(
      execution.flow_id,
      execution.trigger_event_id,
      userId
    );

    if (!newExecutionId) {
      return errorResponse('Erro ao re-executar flow', 500);
    }

    return successResponse(
      {
        execution_id: newExecutionId,
        flow_id: execution.flow_id,
      },
      'Flow re-executado com sucesso'
    );
  } catch (err: any) {
    console.error('❌ [FLOW RE-EXECUTE] Erro:', err);
    return serverErrorResponse(err);
  }
}

