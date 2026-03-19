/**
 * GET /api/groups/fetch/jobs/[id]
 * Retorna o status de um job de busca de grupos (para polling no frontend).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(_req);
    const { id: jobId } = await params;

    if (!jobId) return errorResponse('ID do job é obrigatório', 400);

    const { data: job, error } = await supabaseServiceRole
      .from('group_fetch_jobs')
      .select('id, user_id, instance_name, status, groups_count, error_message, created_at, updated_at')
      .eq('id', jobId)
      .single();

    if (error || !job) return errorResponse('Job não encontrado', 404);
    if (job.user_id !== userId) return errorResponse('Sem permissão para ver este job', 403);

    return successResponse({
      id: job.id,
      instance_name: job.instance_name,
      status: job.status,
      groups_count: job.groups_count ?? null,
      error_message: job.error_message ?? null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
