import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/list-cleaning/[jobId]/stop - Para a verificação e marca o job como concluído.
 * Os números já verificados permanecem e ficam disponíveis para download em CSV.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['admin', 'dono_banca', 'gerente']);
    const { jobId } = await params;
    if (!jobId) return errorResponse('jobId obrigatório', 400);

    const isAdmin = profile?.status === 'admin';
    let query = supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('id, status, validated_count, total_unique')
      .eq('id', jobId);
    if (!isAdmin) query = query.eq('user_id', userId);

    const { data: job, error: jobError } = await query.single();

    if (jobError || !job) return errorResponse('Job não encontrado', 404);

    if (job.status !== 'verifying' && job.status !== 'coffee_pause') {
      return successResponse({
        message: job.status === 'done' ? 'Job já está concluído' : 'Nada a parar',
        job: { ...job, status: job.status },
      });
    }

    const { count: verifiedCount } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .not('verified_at', 'is', null);

    const { count: activeCount } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .eq('whatsapp_status', 'active');

    const { count: notActiveCount } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .in('whatsapp_status', ['inactive', 'unknown']);

    const totalUnique = job.total_unique ?? 0;
    const validated = activeCount ?? 0;
    const notValidated = notActiveCount ?? 0;
    const verified = verifiedCount ?? 0;
    const pending = Math.max(0, totalUnique - verified);

    await supabaseServiceRole
      .from('list_cleaning_jobs')
      .update({
        status: 'done',
        verified_count: verified,
        validated_count: validated,
        not_validated_count: notValidated,
        pending_count: pending,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);

    return successResponse({
      message: 'Verificação interrompida. Os números já verificados estão disponíveis para download.',
      validated_count: validated,
      verified_count: verified,
      pending_count: pending,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
