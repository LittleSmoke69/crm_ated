/**
 * GET /api/admin/zaplink/metrics
 * Retorna métricas: cliques em links, cliques em links de formulário, pendentes, atribuídos
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const [
      { count: totalClicks },
      { count: totalFormClicks },
      { count: totalPending },
      { count: totalAssigned },
      { count: totalCadastrados },
    ] = await Promise.all([
      supabaseServiceRole.from('zaplink_clicks').select('*', { count: 'exact', head: true }),
      supabaseServiceRole.from('zaplink_form_clicks').select('*', { count: 'exact', head: true }),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'assigned'),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'cadastrado'),
    ]);

    return successResponse({
      total_clicks: totalClicks ?? 0,
      total_form_clicks: totalFormClicks ?? 0,
      total_pending: totalPending ?? 0,
      total_assigned: totalAssigned ?? 0,
      total_cadastrados: totalCadastrados ?? 0,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
