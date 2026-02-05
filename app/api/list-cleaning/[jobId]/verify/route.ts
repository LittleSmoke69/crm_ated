import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  ensureRunForJob,
  processOneSlot,
  SLOT_SIZE,
} from '@/lib/services/list-cleaning-slot-service';

export const runtime = 'nodejs';
/** Resposta rápida: só cria run + processa 1 slot (máx ~10 números, ~20s). */
export const maxDuration = 30;

/**
 * POST /api/list-cleaning/[jobId]/verify
 * Inicia ou continua verificação em slots. Processa no máximo 1 slot nesta requisição e retorna rápido.
 * O scheduler (Netlify) processa os próximos slots a cada 1 min.
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

    const apiKey = process.env.WASENDER_API_KEY || '';
    if (!apiKey) {
      return errorResponse('Wasender não configurado. Defina WASENDER_API_KEY no ambiente.', 400);
    }

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

    const { runId, totalNumbers, processedNumbers, alreadyRunning } = await ensureRunForJob(jobId);
    if (totalNumbers === 0) {
      return successResponse({ message: 'Nenhum pendente ou já concluído', job: { ...job, status: 'done' } });
    }

    await supabaseServiceRole
      .from('list_cleaning_jobs')
      .update({ status: 'verifying', session_name_used: 'wasender', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    const slotResult = await processOneSlot(jobId);

    const { data: jobAfter } = await supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('verified_count, validated_count, not_validated_count, pending_count, status')
      .eq('id', jobId)
      .single();

    const stillPending = (jobAfter?.pending_count ?? 0) as number;
    const totalValidated = (jobAfter?.validated_count ?? 0) as number;
    const totalNotValidated = (jobAfter?.not_validated_count ?? 0) as number;

    return successResponse({
      message: slotResult.runCompleted
        ? 'Verificação concluída'
        : `Processado 1 slot (até ${SLOT_SIZE} números). O restante continua em segundo plano — atualize a página para ver o progresso.`,
      processed: slotResult.processed,
      validated: totalValidated,
      not_validated: totalNotValidated,
      pending: stillPending,
      total_numbers: totalNumbers,
      processed_numbers: (jobAfter?.verified_count ?? 0) as number,
      run_completed: slotResult.runCompleted,
      next_run_at: slotResult.hasMore ? undefined : null,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
