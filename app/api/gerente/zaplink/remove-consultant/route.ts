/**
 * POST /api/gerente/zaplink/remove-consultant
 * Remove consultor da rede do gerente (sai da lista de vinculados).
 * Body: { consultant_user_id: string, request_id?: string }
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const body = await req.json().catch(() => ({}));
    const consultantUserId = typeof body.consultant_user_id === 'string' ? body.consultant_user_id.trim() : '';
    const requestId = typeof body.request_id === 'string' ? body.request_id.trim() || null : null;

    if (!consultantUserId) {
      return errorResponse('consultant_user_id é obrigatório.', 400);
    }

    // Verifica se o consultor pertence à rede do gerente (fulfillment ou submission)
    const submissionCheck = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('id')
      .eq('gerente_id', userId)
      .eq('consultor_user_id', consultantUserId)
      .maybeSingle();
    const isInSubmission = !!submissionCheck.data;

    let validRequestId: string | null = null;
    let isInFulfillment = false;

    if (requestId) {
      const { data: reqRow } = await supabaseServiceRole
        .from('zaplink_consultant_requests')
        .select('id')
        .eq('id', requestId)
        .eq('gerente_id', userId)
        .maybeSingle();
      if (reqRow) {
        const { data: fulfillRow } = await supabaseServiceRole
          .from('zaplink_consultant_request_fulfillments')
          .select('id')
          .eq('request_id', requestId)
          .eq('consultant_user_id', consultantUserId)
          .maybeSingle();
        isInFulfillment = !!fulfillRow;
        if (isInFulfillment) validRequestId = requestId;
      }
    } else {
      const { data: fulfillments } = await supabaseServiceRole
        .from('zaplink_consultant_request_fulfillments')
        .select('request_id')
        .eq('consultant_user_id', consultantUserId);
      const requestIds = [...new Set((fulfillments ?? []).map((f: { request_id: string }) => f.request_id))];
      if (requestIds.length > 0) {
        const { data: requests } = await supabaseServiceRole
          .from('zaplink_consultant_requests')
          .select('id')
          .eq('gerente_id', userId)
          .in('id', requestIds);
        const firstMatch = (requests ?? [])[0] as { id: string } | undefined;
        if (firstMatch) {
          isInFulfillment = true;
          validRequestId = firstMatch.id;
        }
      }
    }

    if (!isInFulfillment && !isInSubmission) {
      return errorResponse('Consultor não encontrado na sua rede ou sem permissão para removê-lo.', 403);
    }

    await supabaseServiceRole
      .from('zaplink_consultant_removals')
      .upsert(
        {
          gerente_id: userId,
          consultant_user_id: consultantUserId,
          request_id: validRequestId,
          removed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        { onConflict: 'gerente_id,consultant_user_id', ignoreDuplicates: false }
      );

    return successResponse({ removed: true }, 'Consultor removido da sua rede.');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
