import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/flows/executions/[executionId]/steps
 * Lista steps de uma execução
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { executionId } = await params;

    // Verifica se a execução pertence ao usuário
    const { data: execution } = await supabaseServiceRole
      .from('flow_executions')
      .select('id')
      .eq('id', executionId)
      .eq('user_id', userId)
      .single();

    if (!execution) {
      return errorResponse('Execução não encontrada', 404);
    }

    const { data: steps, error } = await supabaseServiceRole
      .from('flow_execution_steps')
      .select('*')
      .eq('execution_id', executionId)
      .order('execution_order', { ascending: true });

    if (error) {
      console.error('❌ [FLOWS] Erro ao buscar steps:', error);
      return errorResponse('Erro ao buscar steps', 500);
    }

    return successResponse(steps || []);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

