import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/redirect/visit-incomplete
 * Marca redirect_visits.status = 'incomplete' quando o usuário saiu sem concluir o redirect.
 * Body: { visit_id }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { visit_id?: string };
    const { visit_id } = body;
    if (!visit_id) {
      return errorResponse('visit_id é obrigatório', 400);
    }

    const { error } = await supabaseServiceRole
      .from('redirect_visits')
      .update({ status: 'incomplete' })
      .eq('id', visit_id);

    if (error) {
      return errorResponse('Visita não encontrada', 404);
    }

    return successResponse({ ok: true });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
