/**
 * GET /api/groups/fetch/jobs/[id]/wait
 * Mantém a conexão aberta e consulta o job até completar/falhar ou atingir o tempo máximo.
 * Reduz dezenas de GETs de polling para poucas requisições longas.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const POLL_MS = 2000;
const MAX_WAIT_MS = 52_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(_req);
    const { id: jobId } = await params;

    if (!jobId) return errorResponse('ID do job é obrigatório', 400);

    const { data: jobRow, error: firstErr } = await supabaseServiceRole
      .from('group_fetch_jobs')
      .select('id, user_id')
      .eq('id', jobId)
      .single();

    if (firstErr || !jobRow) return errorResponse('Job não encontrado', 404);
    if (jobRow.user_id !== userId) return errorResponse('Sem permissão', 403);

    const deadline = Date.now() + MAX_WAIT_MS;

    while (Date.now() < deadline) {
      const { data: job, error } = await supabaseServiceRole
        .from('group_fetch_jobs')
        .select('id, instance_name, status, groups_count, error_message, updated_at')
        .eq('id', jobId)
        .single();

      if (error || !job) {
        return errorResponse('Job não encontrado', 404);
      }

      if (job.status === 'completed' || job.status === 'failed') {
        return successResponse({
          id: job.id,
          instance_name: job.instance_name,
          status: job.status,
          groups_count: job.groups_count ?? null,
          error_message: job.error_message ?? null,
          updated_at: job.updated_at,
          done: true,
        });
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const { data: last } = await supabaseServiceRole
      .from('group_fetch_jobs')
      .select('id, instance_name, status, groups_count, error_message, updated_at')
      .eq('id', jobId)
      .single();

    return successResponse({
      id: last?.id,
      instance_name: last?.instance_name,
      status: last?.status ?? 'unknown',
      groups_count: last?.groups_count ?? null,
      error_message: last?.error_message ?? null,
      updated_at: last?.updated_at,
      done: false,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
