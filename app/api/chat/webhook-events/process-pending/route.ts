/**
 * POST /api/chat/webhook-events/process-pending
 * Processa eventos da tabela webhook_events e organiza em chat_conversations + chat_messages.
 *
 * Comportamento:
 * - reprocess_all: false (padrão) → apenas events com processed_at IS NULL
 * - reprocess_all: true → todos os eventos (incluindo já processados); útil para sincronizar
 *   histórico completo na primeira abertura do chat ou após reset.
 *
 * Paginação: use offset + limit para processar em lotes.
 * O processamento é idempotente (upsert com ignoreDuplicates nas mensagens).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processMetaPayloadToChat, WHATSAPP_OFFICIAL_TOKEN_ERROR_MSG } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({})) as {
      limit?: number;
      offset?: number;
      reprocess_all?: boolean;
    };

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(body.offset) || 0);
    const reprocessAll = body.reprocess_all === true;

    // Contagem total para informar ao cliente se há mais páginas
    const countQuery = supabaseServiceRole
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('source', SOURCE);

    if (!reprocessAll) {
      countQuery.is('processed_at', null);
    }
    const { count: totalCount } = await countQuery;

    const query = supabaseServiceRole
      .from('webhook_events')
      .select('id, raw_payload, created_at')
      .eq('source', SOURCE)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

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

    const hasMore = offset + list.length < (totalCount ?? 0);

    return successResponse(
      {
        total_count: totalCount ?? 0,
        total_fetched: list.length,
        offset,
        limit,
        has_more: hasMore,
        next_offset: hasMore ? offset + list.length : null,
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
