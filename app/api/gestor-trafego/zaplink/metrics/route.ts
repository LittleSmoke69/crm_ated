/**
 * GET /api/gestor-trafego/zaplink/metrics
 * Métricas do Zaplink apenas para formulários do gestor de tráfego.
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gestor']);

    const { data: formRows } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id')
      .eq('gestor_trafego_user_id', userId);
    const formIds = (formRows ?? []).map((r: { id: string }) => r.id);

    if (formIds.length === 0) {
      return successResponse({
        total_clicks: 0,
        total_form_clicks: 0,
        total_pending: 0,
        total_assigned: 0,
        total_cadastrados: 0,
      });
    }

    const [
      { count: totalFormClicks },
      { count: totalPending },
      { count: totalAssigned },
      { count: totalCadastrados },
    ] = await Promise.all([
      supabaseServiceRole
        .from('zaplink_form_clicks')
        .select('*', { count: 'exact', head: true })
        .in('zaplink_form_id', formIds),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .in('zaplink_form_id', formIds)
        .eq('status', 'pending'),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .in('zaplink_form_id', formIds)
        .eq('status', 'assigned'),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('*', { count: 'exact', head: true })
        .in('zaplink_form_id', formIds)
        .eq('status', 'cadastrado'),
    ]);

    return successResponse({
      total_clicks: 0,
      total_form_clicks: totalFormClicks ?? 0,
      total_pending: totalPending ?? 0,
      total_assigned: totalAssigned ?? 0,
      total_cadastrados: totalCadastrados ?? 0,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
