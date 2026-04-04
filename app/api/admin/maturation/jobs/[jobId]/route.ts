/**
 * PATCH /api/admin/maturation/jobs/[jobId]
 * Pausar, retomar ou abortar qualquer job de maturação (admin).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  pauseVirginInstanceAfterAutoJobAbort,
  skipOpenStepsOnJobAbort,
} from '@/lib/maturation/job-lifecycle';

async function requireAdminMaturation(userId: string) {
  const { data: profile, error } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  if (error) throw new Error('SERVICE_UNAVAILABLE');
  const ok =
    profile &&
    (profile.status === 'super_admin' || profile.status === 'admin' || profile.status === 'dono_banca');
  if (!ok) throw new Error('Acesso negado. Apenas administradores.');
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdminMaturation(userId);

    const { jobId } = await params;
    const body = await req.json();
    const { status } = body;

    if (!status || !['paused', 'running', 'aborted'].includes(status)) {
      return errorResponse('status inválido. Use: paused, running ou aborted', 400);
    }

    const { data: job, error: jobError } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id, status, master_instance_id, plan_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return errorResponse('Job não encontrado', 404);
    }

    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'aborted') {
      updateData.ended_at = new Date().toISOString();
    }

    const { error: updateError } = await supabaseServiceRole
      .from('maturation_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (updateError) {
      return errorResponse('Erro ao atualizar job', 500);
    }

    if (status === 'aborted') {
      await skipOpenStepsOnJobAbort(supabaseServiceRole, jobId);
      await supabaseServiceRole
        .from('master_instances')
        .update({
          is_locked: false,
          locked_job_id: null,
          locked_at: null,
        })
        .eq('id', job.master_instance_id);
      await pauseVirginInstanceAfterAutoJobAbort(
        supabaseServiceRole,
        job.master_instance_id,
        String(job.plan_id || '')
      );
    }

    return successResponse({ job_id: jobId, status }, 'Job atualizado.');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Acesso negado. Apenas administradores.') return errorResponse(msg, 403);
    if (msg === 'SERVICE_UNAVAILABLE') return errorResponse('Serviço temporariamente indisponível.', 503);
    return serverErrorResponse(e);
  }
}
