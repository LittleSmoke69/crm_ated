/**
 * POST /api/chat/webhook-events/process
 * Puxa um evento da tabela webhook_events (por id) e organiza os dados
 * em chat_conversations e chat_messages.
 *
 * - Acionado pelo Supabase Realtime do frontend a cada INSERT em webhook_events.
 * - Idempotente: se processed_at já estiver preenchido, retorna sem reprocessar
 *   (a menos que force=true seja enviado no body).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processMetaPayloadToChat, WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';

export async function POST(req: NextRequest) {
  let event_id: string | undefined;
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({})) as { event_id?: string; force?: boolean };
    event_id = body.event_id;
    const force = body.force ?? false;

    if (!event_id || typeof event_id !== 'string') {
      return errorResponse('event_id é obrigatório', 400);
    }

    const { data: event, error: fetchError } = await supabaseServiceRole
      .from('webhook_events')
      .select('id, source, raw_payload, processed_at')
      .eq('id', event_id)
      .eq('source', SOURCE)
      .single();

    if (fetchError || !event) {
      return errorResponse('Evento não encontrado ou não é do canal whatsapp_official', 404);
    }

    // Evita reprocessamento — a menos que force=true seja enviado explicitamente
    if (event.processed_at && !force) {
      return successResponse(
        { event_id, processed_at: event.processed_at, skipped: true },
        'Evento já processado anteriormente'
      );
    }

    const rawPayload = event.raw_payload as unknown;
    if (!rawPayload || typeof rawPayload !== 'object') {
      return errorResponse('Evento sem raw_payload válido', 400);
    }

    const result = await processMetaPayloadToChat(rawPayload);

    const processedAt = new Date().toISOString();
    await supabaseServiceRole
      .from('webhook_events')
      .update({ processed_at: processedAt })
      .eq('id', event_id);

    return successResponse(
      {
        event_id,
        processed_at: processedAt,
        ...(result.tokenAlert && {
          token_alert: true,
          token_alert_message: WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG,
        }),
      },
      'Evento processado e organizado no chat com sucesso'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG)) {
      return successResponse(
        {
          event_id,
          token_alert: true,
          token_alert_message: WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG,
        },
        'Evento processado com alerta de token'
      );
    }
    return serverErrorResponse(err as Error);
  }
}
