/**
 * POST /api/chat/evolution-events/process
 *
 * Processa um único evento da tabela evolution_webhook_events nas tabelas de chat.
 * Acionado pelo Supabase Realtime do frontend quando um novo evento é inserido.
 * Idempotente: se processed_at já estiver preenchido, retorna sem reprocessar
 * (a menos que force=true seja enviado).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processEvolutionPayloadToChat } from '@/lib/services/evolution-webhook-processor';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({})) as { event_id?: string; force?: boolean };
    const { event_id, force = false } = body;

    if (!event_id || typeof event_id !== 'string') {
      return errorResponse('event_id é obrigatório', 400);
    }

    const { data: event, error: fetchError } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, event_type, payload, processed_at')
      .eq('id', event_id)
      .single();

    if (fetchError || !event) {
      return errorResponse('Evento não encontrado', 404);
    }

    if (event.processed_at && !force) {
      return successResponse(
        { event_id, processed_at: event.processed_at, skipped: true },
        'Evento já processado anteriormente'
      );
    }

    const rawPayload = event.payload as unknown;
    if (!rawPayload || typeof rawPayload !== 'object') {
      return errorResponse('Evento sem payload válido', 400);
    }

    const result = await processEvolutionPayloadToChat(rawPayload);

    const processedAt = new Date().toISOString();
    await supabaseServiceRole
      .from('evolution_webhook_events')
      .update({ processed_at: processedAt })
      .eq('id', event_id);

    return successResponse(
      { event_id, processed_at: processedAt, skipped: result.skipped },
      result.skipped ? 'Evento não relevante para o chat' : 'Evento processado com sucesso'
    );
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
