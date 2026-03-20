/**
 * POST /api/chat/evolution-events/process-pending
 *
 * Processa em lote eventos pendentes da tabela evolution_webhook_events
 * nas tabelas de chat (chat_conversations + chat_messages).
 *
 * Parâmetros:
 *   instance_name  string   — filtra por instância (obrigatório)
 *   limit          number   — eventos por lote (padrão 200, max 1000)
 *   offset         number   — paginação
 *   reprocess_all  boolean  — true = reprocessa todos (inclusive já processados)
 *
 * O processamento é idempotente: saveMessage usa ignoreDuplicates internamente.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processEvolutionPayloadToChat } from '@/lib/services/evolution-webhook-processor';

const CHAT_EVENT_TYPES = ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE', 'MESSAGES_DELETE'];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({})) as {
      instance_name?: string;
      limit?: number;
      offset?: number;
      reprocess_all?: boolean;
    };

    const instanceName = body.instance_name;
    if (!instanceName) {
      return errorResponse('instance_name é obrigatório', 400);
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(body.offset) || 0);
    const reprocessAll = body.reprocess_all === true;

    // Contagem total para paginação
    let countQuery = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('instance_name', instanceName)
      .in('event_type', CHAT_EVENT_TYPES);

    if (!reprocessAll) countQuery = countQuery.is('processed_at', null);
    const { count: totalCount } = await countQuery;

    // Busca os eventos
    let query = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, event_type, payload, received_at')
      .eq('instance_name', instanceName)
      .in('event_type', CHAT_EVENT_TYPES)
      .order('received_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (!reprocessAll) query = query.is('processed_at', null);

    const { data: events, error: fetchError } = await query;

    if (fetchError) {
      return errorResponse(`Erro ao buscar eventos: ${fetchError.message}`, 500);
    }

    const list = events ?? [];
    let processed = 0;
    const errors: string[] = [];

    for (const event of list) {
      const rawPayload = event.payload as unknown;
      if (!rawPayload || typeof rawPayload !== 'object') {
        errors.push(`Evento ${event.id}: payload inválido`);
        continue;
      }
      try {
        await processEvolutionPayloadToChat(rawPayload);
        await supabaseServiceRole
          .from('evolution_webhook_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', event.id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Evento ${event.id}: ${msg}`);
      }
    }

    const hasMore = offset + list.length < (totalCount ?? 0);

    return successResponse({
      total_count: totalCount ?? 0,
      total_fetched: list.length,
      offset,
      limit,
      has_more: hasMore,
      next_offset: hasMore ? offset + list.length : null,
      processed,
      errors: errors.length > 0 ? errors : undefined,
    }, `Processados ${processed} de ${list.length} eventos.`);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
