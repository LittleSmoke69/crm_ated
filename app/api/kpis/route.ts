import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/kpis - Retorna KPIs do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Busca todas as métricas em paralelo
    const [
      { count: sent },
      { count: added },
      { count: pending },
      { count: connected },
      { count: failedSends },
      { count: failedAdds },
    ] = await Promise.all([
      supabaseServiceRole
        .from('searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status_disparo', true),
      supabaseServiceRole
        .from('searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status_add_gp', true),
      supabaseServiceRole
        .from('searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending'),
      supabaseServiceRole
        .from('whatsapp_instances')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'connected'),
      supabaseServiceRole
        .from('searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'failed')
        .eq('status_disparo', false),
      supabaseServiceRole
        .from('searches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'failed')
        .eq('status_add_gp', false),
    ]);

    return successResponse({
      sent: sent || 0,
      added: added || 0,
      pending: pending || 0,
      connected: connected || 0,
      failedSends: failedSends || 0,
      failedAdds: failedAdds || 0,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar KPIs', 401);
  }
}

