import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/redirect/complete
 * Marca redirect_clicks.completed_at, opcionalmente redirect_visits.status = 'complete', e REDIRECT_COMPLETE na sessão.
 * Body: { click_id, sid?, visit_id? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { click_id?: string; sid?: string; visit_id?: string };
    const { click_id, sid, visit_id } = body;
    if (!click_id) {
      return errorResponse('click_id é obrigatório', 400);
    }

    const { data: click, error: updateError } = await supabaseServiceRole
      .from('redirect_clicks')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', click_id)
      .select('id, project_id, session_id')
      .single();

    if (updateError || !click) {
      return errorResponse('Click não encontrado ou já concluído', 404);
    }

    if (visit_id) {
      await supabaseServiceRole
        .from('redirect_visits')
        .update({ status: 'complete' })
        .eq('id', visit_id);
    }

    if (sid && click.session_id === sid) {
      await supabaseServiceRole.from('vsl_events').insert({
        session_id: sid,
        project_id: click.project_id,
        event_name: 'REDIRECT_COMPLETE',
        event_id: crypto.randomUUID(),
        metadata: { click_id, visit_id: visit_id ?? null },
      });
    }

    return successResponse({ ok: true });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
