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
          instagram_handle,
          status,
          assigned_at,
          zaplink_forms ( name, slug ),
          crm_bancas ( name )
        )
      `)
      .eq('gerente_id', userId)
      .is('seen_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return successResponse([]);
    }

    const list = (notifications ?? []).map((n: any) => {
      const sub = n.zaplink_form_submissions;
      const form = Array.isArray(sub?.zaplink_forms) ? sub.zaplink_forms[0] : sub?.zaplink_forms;
      const banca = Array.isArray(sub?.crm_bancas) ? sub.crm_bancas[0] : sub?.crm_bancas;
      return {
        id: n.id,
        zaplink_submission_id: n.zaplink_submission_id,
        seen_at: n.seen_at,
        created_at: n.created_at,
        submission: sub
          ? {
              id: sub.id,
              full_name: sub.full_name,
              email: sub.email,
              phone: sub.phone,
              instagram_handle: sub.instagram_handle ?? null,
              status: sub.status,
              assigned_at: sub.assigned_at,
              form_name: form?.name ?? null,
              banca_name: banca?.name ?? null,
            }
          : null,
      };
    });

    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
