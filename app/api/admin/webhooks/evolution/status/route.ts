import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/webhooks/evolution/status
 * Retorna status dos webhooks (últimos eventos recebidos em prod/test)
 * 
 * Retorna: {
 *   prod: { last_event_at: string | null, seconds_ago: number | null },
 *   test: { last_event_at: string | null, seconds_ago: number | null }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    // Busca último evento de PROD
    const { data: lastProdEvent } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('received_at')
      .eq('env', 'prod')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();

    // Busca último evento de TEST
    const { data: lastTestEvent } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('received_at')
      .eq('env', 'test')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();

    const now = new Date();

    const getSecondsAgo = (timestamp: string | null | undefined): number | null => {
      if (!timestamp) return null;
      const eventDate = new Date(timestamp);
      return Math.floor((now.getTime() - eventDate.getTime()) / 1000);
    };

    return successResponse({
      prod: {
        last_event_at: lastProdEvent?.received_at || null,
        seconds_ago: getSecondsAgo(lastProdEvent?.received_at),
      },
      test: {
        last_event_at: lastTestEvent?.received_at || null,
        seconds_ago: getSecondsAgo(lastTestEvent?.received_at),
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar status', 401);
  }
}

