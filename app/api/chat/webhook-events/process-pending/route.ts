/**
 * POST /api/chat/webhook-events/process-pending
 * Puxa da tabela webhook_events os eventos ainda não processados (processed_at IS NULL),
 * trata cada raw_payload e organiza em chat_conversations e chat_messages.
 * Usado para mostrar conversas antigas: eventos que já estavam salvos passam a gerar
 * conversas e mensagens no chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processMetaPayloadToChat, WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';
const DEFAULT_LIMIT = 100;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(500, Math.max(1, parseInt((body as { limit?: number }).limit as unknown as string, 10) || DEFAULT_LIMIT));
    const reprocessAll = (body as { reprocess_all?: boolean }).reprocess_all === true;

    const query = supabaseServiceRole
      .from('webhook_events')
      .select('id, raw_payload, created_at')
      .eq('source', SOURCE)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (!reprocessAll) {
      query.is('processed_at', null);
    }

    const { data: events, error: fetchError } = await query;

    if (fetchError) {
      console.error('[Zaploto Chat] process-pending fetch error:', fetchError.message);
      return errorResponse(`Erro ao buscar eventos: ${fetchError.message}`, 500);
    }

    const list = events ?? [];
    let processed = 0;
    const errors: string[] = [];
    let tokenAlert = false;
    let tokenAlertMessage = '';

    for (const event of list) {
      const rawPayload = event.raw_payload as unknown;
      if (!rawPayload || typeof rawPayload !== 'object') {
        errors.push(`Evento ${event.id}: raw_payload inválido`);
        continue;
      }
      try {
        const result = await processMetaPayloadToChat(rawPayload);
        await supabaseServiceRole
          .from('webhook_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', event.id);
        processed++;
        if (result.tokenAlert) {
          tokenAlert = true;
          tokenAlertMessage = WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Zaploto Chat] Erro ao processar evento', event.id, err);
        errors.push(`Evento ${event.id}: ${msg}`);
        if (msg.includes(WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG)) {
          tokenAlert = true;
          tokenAlertMessage = WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG;
        }
      }
    }

    return successResponse(
      {
        total_fetched: list.length,
        processed,
        errors: errors.length > 0 ? errors : undefined,
        ...(tokenAlert && { token_alert: true, token_alert_message: tokenAlertMessage }),
      },
      `Processados ${processed} de ${list.length} eventos.`
    );
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
