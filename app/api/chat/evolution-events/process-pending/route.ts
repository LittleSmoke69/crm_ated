/**
 * POST /api/chat/evolution-events/process-pending
 *
 * Backfill de chat_conversations/chat_messages a partir de evolution_webhook_events.
 * Em operação normal, o worker RabbitMQ (rabbitmq-worker) já popula chat em tempo
 * real e marca `processed_at`. Este endpoint serve como rede de segurança para:
 *   - eventos antigos pré-worker
 *   - falhas de chat persistence no worker (worker continua, evento fica !processed_at)
 *   - reprocessamento manual quando o admin solicita
 *
 * Parâmetros:
 *   instance_name        string   obrigatório — filtra por instância
 *   limit                number   default 200, max 1000
 *   offset               number   paginação
 *   since                ISO8601  só processa eventos com received_at >= since
 *                                 (default: 1h atrás — evita varrer backlog antigo)
 *   reprocess_all        boolean  default false — true reprocessa já processados
 *   verify_all_messages  boolean  default true  — verifica se chat_messages tem
 *                                 a mensagem; se faltar, força reprocessamento
 *
 * Idempotência: saveMessage/upsertConversation usam ignoreDuplicates/upsert.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processEvolutionPayloadToChat } from '@/lib/services/evolution-webhook-processor';

const CHAT_EVENT_TYPES = ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE', 'MESSAGES_DELETE'];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function extractEvolutionMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object')
    ? (root.data as Record<string, unknown>)
    : root;
  const message = (data.message && typeof data.message === 'object')
    ? (data.message as Record<string, unknown>)
    : data;
  const key = (message.key && typeof message.key === 'object')
    ? (message.key as Record<string, unknown>)
    : ((data.key && typeof data.key === 'object') ? (data.key as Record<string, unknown>) : null);

  const rawMessageId = key?.id ?? data.id ?? data.messageId ?? message.id;
  if (typeof rawMessageId !== 'string') return null;
  const normalized = rawMessageId.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({})) as {
      instance_name?: string;
      limit?: number;
      offset?: number;
      since?: string;
      reprocess_all?: boolean;
      verify_all_messages?: boolean;
    };

    const instanceName = body.instance_name;
    if (!instanceName) {
      return errorResponse('instance_name é obrigatório', 400);
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(body.offset) || 0);
    const reprocessAll = body.reprocess_all === true;
    const verifyAllMessages = body.verify_all_messages !== false;

    // since default = 1h atrás. Evita escanear backlog inteiro a cada abertura
    // do chat (era a causa do 5min de espera). Frontend pode passar timestamp
    // específico, ex.: "última mensagem conhecida".
    let sinceIso: string | null = null;
    if (typeof body.since === 'string' && body.since.trim()) {
      const parsed = new Date(body.since);
      if (!isNaN(parsed.getTime())) sinceIso = parsed.toISOString();
    }
    if (!sinceIso && !reprocessAll) {
      sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }

    const { data: instanceRow, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    if (instanceError || !instanceRow?.id) {
      return errorResponse('Instância não encontrada ou inativa para reconciliação.', 404);
    }

    // Contagem total para paginação
    let countQuery = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('instance_name', instanceName)
      .in('event_type', CHAT_EVENT_TYPES);

    if (!reprocessAll) countQuery = countQuery.is('processed_at', null);
    if (sinceIso) countQuery = countQuery.gte('received_at', sinceIso);
    const { count: totalCount } = await countQuery;

    // Busca os eventos
    let query = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, event_type, payload, received_at, processed_at')
      .eq('instance_name', instanceName)
      .in('event_type', CHAT_EVENT_TYPES)
      .order('received_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (!reprocessAll) query = query.is('processed_at', null);
    if (sinceIso) query = query.gte('received_at', sinceIso);

    const { data: events, error: fetchError } = await query;

    if (fetchError) {
      return errorResponse(`Erro ao buscar eventos: ${fetchError.message}`, 500);
    }

    const list = events ?? [];
    let processed = 0;
    let missing_messages_found = 0;
    const errors: string[] = [];

    for (const event of list) {
      const rawPayload = event.payload as unknown;
      if (!rawPayload || typeof rawPayload !== 'object') {
        errors.push(`Evento ${event.id}: payload inválido`);
        continue;
      }

      let shouldProcess = reprocessAll || !event.processed_at;
      const isMessageEvent = event.event_type === 'MESSAGES_UPSERT' || event.event_type === 'SEND_MESSAGE';

      if (verifyAllMessages && isMessageEvent) {
        const messageId = extractEvolutionMessageId(rawPayload);
        if (messageId) {
          const { data: existingMessage, error: messageLookupError } = await supabaseServiceRole
            .from('chat_messages')
            .select('id')
            .eq('instance_id', instanceRow.id)
            .eq('message_id', messageId)
            .limit(1)
            .maybeSingle();

          if (messageLookupError) {
            errors.push(`Evento ${event.id}: erro ao validar mensagem ${messageId} (${messageLookupError.message})`);
            continue;
          }

          if (!existingMessage) {
            missing_messages_found++;
            shouldProcess = true;
          }
        }
      }

      if (!shouldProcess) continue;

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
      since: sinceIso,
      reprocess_all: reprocessAll,
      has_more: hasMore,
      next_offset: hasMore ? offset + list.length : null,
      processed,
      verify_all_messages: verifyAllMessages,
      missing_messages_found,
      errors: errors.length > 0 ? errors : undefined,
    }, `Processados ${processed} de ${list.length} eventos.`);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
