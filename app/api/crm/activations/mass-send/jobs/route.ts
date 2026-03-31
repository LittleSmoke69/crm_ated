/**
 * GET /api/crm/activations/mass-send/jobs
 * Lista campanhas de disparo em massa do usuário (para acompanhamento).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: jobs, error } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('id, message_id, message_title, instance_name, group_ids, status, total_groups, sent_count, failed_count, processed_index, last_error, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return serverErrorResponse(error);

    return successResponse(jobs ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
