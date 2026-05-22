import { NextRequest } from 'next/server';
import { verifyRedirectClickToken, verifyRedirectVisitToken } from '@/lib/redirect/tracking-token';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/redirect/complete
 * Body: { click_id, click_token, sid?, visit_id?, visit_token? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      click_id?: string;
      click_token?: string;
      sid?: string;
      visit_id?: string;
      visit_token?: string;
    };
    const { click_id, click_token, sid, visit_id, visit_token } = body;
    if (!click_id) {
      return errorResponse('click_id é obrigatório', 400);
    }

    const clickOk = await verifyRedirectClickToken(click_id, click_token);
    if (!clickOk) {
      return errorResponse('Token de click inválido ou expirado', 403);
    }

    const { data: click, error: updateError } = await supabaseServiceRole
      .from('redirect_clicks')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', click_id)
      .select('id, project_id, session_id, redirect_slug_id')
      .single();

    if (updateError || !click) {
      return errorResponse('Click não encontrado', 404);
    }

    if (visit_id) {
      const visitOk = await verifyRedirectVisitToken(visit_id, visit_token);
      if (!visitOk) {
        return errorResponse('Token de visita inválido ou expirado', 403);
      }
      const { data: visit } = await supabaseServiceRole
        .from('redirect_visits')
        .select('id, project_id, redirect_slug_id')
        .eq('id', visit_id)
        .maybeSingle();
      if (!visit || visit.project_id !== click.project_id) {
        return errorResponse('Visita não pertence ao mesmo projeto do click', 400);
      }
      await supabaseServiceRole.from('redirect_visits').update({ status: 'complete' }).eq('id', visit_id);
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
