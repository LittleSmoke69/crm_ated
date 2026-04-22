import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  ensureRunForJob,
  runListCleaningVerificationUntilStoppedOrDone,
} from '@/lib/services/list-cleaning-slot-service';
import { resolveEvolutionInstanceForListCleaningVerification } from '@/lib/server/list-cleaning-evolution-instance';

export const runtime = 'nodejs';
/** Uma requisição processa a fila inteira: um número por vez na Evolution (POST direto por número), ~1 s entre cada; Wasender igual. */
export const maxDuration = 3600;

/**
 * POST /api/list-cleaning/[jobId]/verify
 * Inicia a verificação: processa todos os pendentes em sequência (1s entre cada).
 * Parar: POST /stop (o laço encerra ao detectar que o job deixou de estar `verifying`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['super_admin', 'admin', 'dono_banca', 'gerente']);
    const { jobId } = await params;
    if (!jobId) return errorResponse('jobId obrigatório', 400);

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    let query = supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('*')
      .eq('id', jobId);
    if (!isAdmin) query = query.eq('user_id', userId);

    const { data: job, error: jobError } = await query.single();

    if (jobError || !job) return errorResponse('Job não encontrado', 404);
    if (job.status === 'paused_disconnected') {
      return errorResponse('Verificação desativada temporariamente.', 400);
    }
    if (job.status === 'done') {
      return successResponse({ message: 'Job já concluído', job });
    }

    const body = await req.json().catch(() => ({}));
    const requestedInstanceId =
      typeof body.evolutionInstanceId === 'string' ? body.evolutionInstanceId.trim() : '';

    const existingInstanceId = job.verification_evolution_instance_id as string | null | undefined;
    let sessionLabel = (job.session_name_used as string | null) ?? '';

    if (!existingInstanceId) {
      if (!requestedInstanceId) {
        return errorResponse(
          'Selecione uma instância WhatsApp para verificar os números.',
          400
        );
      }
      const resolved = await resolveEvolutionInstanceForListCleaningVerification(
        requestedInstanceId,
        userId,
        profile?.status ?? undefined
      );
      if (!resolved.ok) return errorResponse(resolved.message, 400);

      await supabaseServiceRole
        .from('list_cleaning_jobs')
        .update({
          verification_evolution_instance_id: requestedInstanceId,
          session_name_used: resolved.instance_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      sessionLabel = resolved.instance_name;
    } else {
      if (requestedInstanceId && requestedInstanceId !== existingInstanceId) {
        return errorResponse('Este job já está vinculado a outra instância.', 400);
      }
      if (!sessionLabel) {
        const { data: einst } = await supabaseServiceRole
          .from('evolution_instances')
          .select('instance_name')
          .eq('id', existingInstanceId)
          .single();
        sessionLabel = einst?.instance_name ?? 'evolution';
      }
    }

    /** Mesmo UUID persistido no job; o laço não depende só do SELECT seguinte (réplica/atraso). */
    const evolutionInstanceIdForRun =
      (existingInstanceId as string | undefined) || requestedInstanceId || undefined;

    const { data: pendingItems, error: pendingError } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id')
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .is('verified_at', null)
      .limit(1);

    if (pendingError || !pendingItems?.length) {
      await supabaseServiceRole
        .from('list_cleaning_jobs')
        .update({ status: 'done', pending_count: 0, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      return successResponse({ message: 'Nenhum pendente ou já concluído', job: { ...job, status: 'done' } });
    }

    const { totalNumbers } = await ensureRunForJob(jobId);
    if (totalNumbers === 0) {
      return successResponse({ message: 'Nenhum pendente ou já concluído', job: { ...job, status: 'done' } });
    }

    await supabaseServiceRole
      .from('list_cleaning_jobs')
      .update({ status: 'verifying', session_name_used: sessionLabel, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    const loopResult = await runListCleaningVerificationUntilStoppedOrDone(jobId, {
      verificationEvolutionInstanceId: evolutionInstanceIdForRun,
    });

    const { data: jobAfter } = await supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('verified_count, validated_count, not_validated_count, pending_count, status')
      .eq('id', jobId)
      .single();

    const stillPending = (jobAfter?.pending_count ?? 0) as number;
    const totalValidated = (jobAfter?.validated_count ?? 0) as number;
    const totalNotValidated = (jobAfter?.not_validated_count ?? 0) as number;

    let message = loopResult.stopped
      ? 'Verificação interrompida (parar).'
      : loopResult.runCompleted
        ? 'Verificação concluída'
        : 'Verificação finalizada';

    if (loopResult.evolutionSessionDropped) {
      message =
        'A instância WhatsApp desconectou durante a verificação. Ela foi marcada como desconectada em Instâncias WhatsApp — reconecte e tente novamente.';
    }

    return successResponse({
      message,
      evolution_session_dropped: Boolean(loopResult.evolutionSessionDropped),
      stopped: loopResult.stopped,
      processed: loopResult.processedSession,
      validated: totalValidated,
      not_validated: totalNotValidated,
      pending: stillPending,
      total_numbers: totalNumbers,
      processed_numbers: (jobAfter?.verified_count ?? 0) as number,
      run_completed: loopResult.runCompleted,
      next_run_at: null,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
