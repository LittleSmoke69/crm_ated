import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { normalizationService } from '@/lib/services/normalization-service';

/**
 * POST /api/admin/flows/[flowId]/test
 * Executa um Flow manualmente com um payload customizado (para testes)
 * 
 * Body:
 * - payload: objeto JSON com o payload do evento
 * - event_type: tipo do evento (opcional, padrão: 'MESSAGES_UPSERT')
 * - instance_name: nome da instância (opcional)
 * - payload_normalized: payload normalizado (opcional, será usado se fornecido)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { flowId } = await params;
    const body = await req.json();

    const { payload, event_type, instance_name, payload_normalized } = body;

    if (!payload || typeof payload !== 'object') {
      return errorResponse('payload é obrigatório e deve ser um objeto JSON', 400);
    }

    // Verifica se o flow existe e pertence ao usuário
    const { data: flow, error: flowError } = await supabaseServiceRole
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    // Normaliza o payload se não foi fornecido um payload_normalized
    let normalizedPayload = payload_normalized;
    if (!normalizedPayload) {
      try {
        normalizedPayload = await normalizationService.normalizePayload(
          event_type || 'MESSAGES_UPSERT',
          payload,
          instance_name || undefined
        );
      } catch (normalizeError: any) {
        console.warn('⚠️ [FLOW TEST] Erro ao normalizar payload, usando payload original:', normalizeError);
        normalizedPayload = payload;
      }
    }

    // Cria um evento temporário no banco para usar na execução
    const eventData: any = {
      env: 'test', // Marca como teste
      event_type: event_type || 'MESSAGES_UPSERT',
      instance_name: instance_name || null,
      remote_jid: payload?.key?.remoteJid || payload?.remoteJid || payload?.data?.key?.remoteJid || null,
      message_id: payload?.key?.id || payload?.messageId || payload?.data?.key?.id || null,
      payload: payload,
      payload_normalized: normalizedPayload,
      received_at: new Date().toISOString(),
    };

    const { data: testEvent, error: eventError } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .insert(eventData)
      .select()
      .single();

    if (eventError || !testEvent) {
      console.error('❌ [FLOW TEST] Erro ao criar evento de teste:', eventError);
      return errorResponse('Erro ao criar evento de teste', 500);
    }

    try {
      // Executa o flow
      const executionId = await flowExecutorService.executeFlow(flowId, testEvent.id, userId);

      if (!executionId) {
        return errorResponse('Erro ao executar flow', 500);
      }

      // Busca detalhes da execução
      const { data: execution, error: execError } = await supabaseServiceRole
        .from('flow_executions')
        .select(`
          *,
          flow_execution_steps (
            id,
            node_id,
            node_type,
            status,
            started_at,
            ended_at,
            duration_ms,
            input_json,
            output_json,
            error_message,
            execution_order
          )
        `)
        .eq('id', executionId)
        .single();

      if (execError) {
        console.error('❌ [FLOW TEST] Erro ao buscar execução:', execError);
      }

      return successResponse({
        execution_id: executionId,
        execution: execution,
        test_event_id: testEvent.id,
      }, 'Flow executado com sucesso');
    } catch (execError: any) {
      console.error('❌ [FLOW TEST] Erro na execução:', execError);
      return errorResponse(`Erro ao executar flow: ${execError.message}`, 500);
    }
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

