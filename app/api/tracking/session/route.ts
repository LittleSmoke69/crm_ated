import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { sha256 } from '@/lib/vsl/hash';

export const dynamic = 'force-dynamic';

type SessionBody = {
  project_id: string;
  page_id: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  fbclid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

/**
 * POST /api/tracking/session
 * Cria sessão VSL e retorna session_id (público, usado na VSL page).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as SessionBody;
    const { project_id, page_id } = body;
    if (!project_id || !page_id) {
      return errorResponse('project_id e page_id são obrigatórios', 400);
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '';
    const ua = req.headers.get('user-agent') ?? '';
    const ip_hash = ip ? sha256(ip) : null;
    const ua_hash = ua ? sha256(ua) : null;

    const { data: row, error } = await supabaseServiceRole
      .from('vsl_sessions')
      .insert({
        project_id,
        page_id,
        utm_source: body.utm_source ?? null,
        utm_medium: body.utm_medium ?? null,
        utm_campaign: body.utm_campaign ?? null,
        utm_content: body.utm_content ?? null,
        utm_term: body.utm_term ?? null,
        fbclid: body.fbclid ?? null,
        fbp: body.fbp ?? null,
        fbc: body.fbc ?? null,
        ip_hash: ip_hash ?? null,
        ua_hash: ua_hash ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[tracking/session]', error.message);
      return errorResponse('Erro ao criar sessão', 500);
    }
    return successResponse({ session_id: row.id });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
