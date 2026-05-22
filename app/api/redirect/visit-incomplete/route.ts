import { NextRequest } from 'next/server';
import { verifyRedirectVisitToken } from '@/lib/redirect/tracking-token';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/redirect/visit-incomplete
 * Body: { visit_id, visit_token }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { visit_id?: string; visit_token?: string };
    const { visit_id, visit_token } = body;
    if (!visit_id) {
      return errorResponse('visit_id é obrigatório', 400);
    }

    const visitOk = await verifyRedirectVisitToken(visit_id, visit_token);
    if (!visitOk) {
      return errorResponse('Token de visita inválido ou expirado', 403);
    }

    const { data: visit, error } = await supabaseServiceRole
      .from('redirect_visits')
      .update({ status: 'incomplete' })
      .eq('id', visit_id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error || !visit) {
      return errorResponse('Visita não encontrada ou já finalizada', 404);
    }

    return successResponse({ ok: true });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
