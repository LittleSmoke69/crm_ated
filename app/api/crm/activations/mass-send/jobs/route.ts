/**
 * GET /api/crm/activations/mass-send/jobs
 * Lista campanhas de disparo em massa do usuário (para acompanhamento).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    const canSeeAll =
      profile?.status === 'super_admin' || profile?.status === 'admin';

    let q = supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select(
        'id, user_id, message_id, message_title, instance_name, instance_names, group_ids, status, total_groups, sent_count, failed_count, processed_index, last_error, inter_group_delay_ms, created_at, updated_at'
      )
      .order('created_at', { ascending: false })
      .limit(50);

    if (!canSeeAll) {
      q = q.eq('user_id', userId);
    }

    const { data: jobs, error } = await q;

    if (error) return serverErrorResponse(error);

    return successResponse(jobs ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
