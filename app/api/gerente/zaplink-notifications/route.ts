/**
 * GET /api/gerente/zaplink-notifications
 * Lista zaplink_gerente_notifications não vistas (seen_at IS NULL) para o gerente logado
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const { data: notifications, error } = await supabaseServiceRole
      .from('zaplink_gerente_notifications')
      .select(`
        id,
        zaplink_submission_id,
        seen_at,
        created_at,
        zaplink_form_submissions (
          id,
          full_name,
          email,
          phone,
          status,
          assigned_at
        )
      `)
      .eq('gerente_id', userId)
      .is('seen_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return successResponse([]);
    }

    const list = (notifications ?? []).map((n: any) => ({
      id: n.id,
      zaplink_submission_id: n.zaplink_submission_id,
      seen_at: n.seen_at,
      created_at: n.created_at,
      submission: n.zaplink_form_submissions,
    }));

    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
