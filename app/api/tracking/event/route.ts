import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { sendCapiEvent } from '@/lib/vsl/capi';
import { sha256 } from '@/lib/vsl/hash';

export const dynamic = 'force-dynamic';

type EventBody = {
  session_id: string;
  event_name: string;
  event_id: string;
  metadata?: Record<string, unknown>;
};

/**
 * POST /api/tracking/event
 * Registra evento no DB (dedupe por event_id) e envia CAPI se projeto tiver token (server-side).
 * Público (chamado pela VSL).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as EventBody;
    const { session_id, event_name, event_id } = body;
    if (!session_id || !event_name || !event_id) {
      return errorResponse('session_id, event_name e event_id são obrigatórios', 400);
    }

    const { data: session } = await supabaseServiceRole
      .from('vsl_sessions')
      .select('project_id')
      .eq('id', session_id)
      .single();
    if (!session) {
      return errorResponse('Sessão não encontrada', 404);
    }

    const { data: eventRow, error: insertError } = await supabaseServiceRole
      .from('vsl_events')
      .insert({
        session_id,
        project_id: session.project_id,
        event_name,
        event_id,
        metadata: body.metadata ?? {},
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return successResponse({ recorded: true, duplicate: true });
      }
      console.error('[tracking/event]', insertError.message);
      return errorResponse('Erro ao registrar evento', 500);
    }

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('pixel_id, capi_access_token, meta_graph_base_url')
      .eq('id', session.project_id)
      .single();

    if (project?.pixel_id && project?.capi_access_token) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '';
      const ua = req.headers.get('user-agent') ?? '';
      const { data: sessionRow } = await supabaseServiceRole
        .from('vsl_sessions')
        .select('fbp, fbc')
        .eq('id', session_id)
        .single();

      const payload = {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id,
        action_source: 'website' as const,
        user_data: {
          fbp: sessionRow?.fbp ?? undefined,
          fbc: sessionRow?.fbc ?? undefined,
          client_ip_address: ip || undefined,
          client_user_agent: ua || undefined,
        },
        custom_data: body.metadata ?? {},
      };
      await sendCapiEvent(
        project.pixel_id,
        project.capi_access_token,
        project.meta_graph_base_url,
        payload
      );
    }

    return successResponse({ recorded: true, id: eventRow.id });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
