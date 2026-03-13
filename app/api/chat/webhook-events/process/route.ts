/**
 * POST /api/chat/webhook-events/process
 * Puxa um evento da tabela webhook_events (por id) e organiza os dados
 * em chat_conversations e chat_messages.
 * Útil para reprocessar eventos ou processar em tempo real via Realtime.
 * Requer autenticação (admin/suporte ou mesmo usuário do chat).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processMetaPayloadToChat } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const event_id = (body as { event_id?: string }).event_id;

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

    const rawPayload = event.raw_payload as unknown;
    if (!rawPayload || typeof rawPayload !== 'object') {
      return errorResponse('Evento sem raw_payload válido', 400);
    }

    await processMetaPayloadToChat(rawPayload);

    await supabaseServiceRole
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', event_id);

    return successResponse(
      { event_id, processed_at: new Date().toISOString() },
      'Evento processado e organizado no chat com sucesso'
    );
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
