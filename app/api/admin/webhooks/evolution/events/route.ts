import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES,
  isEvolutionGroupParticipantEventType,
} from '@/lib/utils/evolution-group-participant-event-types';

/**
 * GET /api/admin/webhooks/evolution/events
 * Lista eventos recebidos via webhook com filtros e paginação
 * 
 * Query params:
 * - env: 'prod' | 'test'
 * - event_type: tipo do evento
 * - q: busca por instance_name, remote_jid ou message_id
 * - page: número da página (padrão: 1)
 * - limit: itens por página (padrão: 25)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { searchParams } = req.nextUrl;

    const env = searchParams.get('env');
    const eventType = searchParams.get('event_type');
    const eventId = searchParams.get('eventId');
    const q = searchParams.get('q');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 100);

    // Se eventId foi fornecido, busca o evento específico
    if (eventId) {
      let queryById = supabaseServiceRole
        .from('evolution_webhook_events')
        .select('*')
        .eq('id', eventId);

      if (env && (env === 'prod' || env === 'test')) {
        queryById = queryById.eq('env', env);
      }

      const { data: event, error: eventError } = await queryById.single();

      if (eventError || !event) {
        return errorResponse('Evento não encontrado', 404);
      }

      return successResponse([event]);
    }

    let query = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('*', { count: 'exact' });

    // Filtros
    if (env && (env === 'prod' || env === 'test')) {
      query = query.eq('env', env);
    }

    if (eventType) {
      // Mesmo evento chega como GROUP_PARTICIPANTS_UPDATE (Evolution) ou group-participants.update (template)
      if (isEvolutionGroupParticipantEventType(eventType)) {
        query = query.in('event_type', EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES);
      } else {
        query = query.eq('event_type', eventType);
      }
    }

    if (q) {
      query = query.or(`instance_name.ilike.%${q}%,remote_jid.ilike.%${q}%,message_id.ilike.%${q}%`);
    }

    // Ordenação (mais recentes primeiro)
    query = query.order('received_at', { ascending: false });

    // Paginação
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: events, error, count } = await query;

    if (error) {
      console.error('❌ [WEBHOOK EVENTS] Erro ao buscar eventos:', error);
      return errorResponse('Erro ao buscar eventos', 500);
    }

    const totalPages = count ? Math.ceil(count / limit) : 0;

    return successResponse(events || [], {
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar eventos', 401);
  }
}

