/**
 * API Route: /api/maturation/jobs
 *
 * GET: Lista apenas jobs do usuário autenticado.
 * POST: Cria novo job (delega para runMaturationStart — mesmo núcleo que POST /api/maturation/start).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationStart } from '@/lib/services/maturation/start-job';

const JOB_DETAIL_SELECT = `
  *,
  maturation_plans (
    id,
    name,
    description
  ),
  master_instances (
    id,
    evolution_instance_id,
    evolution_instances (
      id,
      instance_name,
      status
    )
  )
`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    // Query params
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // queued|running|paused|finished|failed|aborted
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    // Monta query
    let query = supabaseServiceRole
      .from('maturation_jobs')
      .select(JOB_DETAIL_SELECT)
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: jobs, error } = await query;
    
    if (error) {
      console.error('[GET /api/maturation/jobs] Erro:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar jobs' },
        { status: 500 }
      );
    }

    const mergedJobs = [...(jobs || [])];
    mergedJobs.sort(
      (a: { created_at: string }, b: { created_at: string }) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    /** Próximo disparo: rodando ou pausado (a UI “Maturação em execução” cobre ambos). */
    const jobsWithScheduleIds = mergedJobs
      .filter((j: any) => j.status === 'running' || j.status === 'paused')
      .map((j: any) => j.id);
    let nextScheduledByJob: Record<string, string> = {};
    if (jobsWithScheduleIds.length > 0) {
      const { data: pendingSteps } = await supabaseServiceRole
        .from('maturation_steps')
        .select('job_id, scheduled_at')
        .in('job_id', jobsWithScheduleIds)
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true });
      const byJob: Record<string, string> = {};
      for (const row of pendingSteps || []) {
        if (!byJob[row.job_id]) byJob[row.job_id] = row.scheduled_at;
      }
      nextScheduledByJob = byJob;
    }

    const allJobIds = mergedJobs.map((j: any) => j.id);
    const stepRowsByJob: Record<string, Array<{ step_index: number; status: string }>> = {};
    if (allJobIds.length > 0) {
      const { data: stepRows } = await supabaseServiceRole
        .from('maturation_steps')
        .select('job_id, step_index, status')
        .in('job_id', allJobIds)
        .order('step_index', { ascending: true });
      for (const row of stepRows || []) {
        if (!stepRowsByJob[row.job_id]) stepRowsByJob[row.job_id] = [];
        stepRowsByJob[row.job_id].push({ step_index: row.step_index, status: row.status });
      }
    }

    function buildStepStatuses(jobId: string, total: number): string[] {
      const rows = stepRowsByJob[jobId] || [];
      const arr = Array.from({ length: total }, () => 'pending');
      for (const r of rows) {
        if (r.step_index >= 0 && r.step_index < total) arr[r.step_index] = r.status;
      }
      return arr;
    }

    // Formata resposta
    const formattedJobs = mergedJobs.map((job: any) => {
      const instance = Array.isArray(job.master_instances?.evolution_instances)
        ? job.master_instances.evolution_instances[0]
        : job.master_instances?.evolution_instances;
      const total = job.progress_total || 0;
      const stepStatuses = buildStepStatuses(job.id, total);
      const stepsSent = stepStatuses.filter((s) => s === 'sent').length;
      const stepsFailed = stepStatuses.filter((s) => s === 'failed').length;
      const stepsPending = stepStatuses.filter((s) => s === 'pending' || s === 'processing').length;
      const evoId =
        (job.master_instances as { evolution_instance_id?: string } | undefined)?.evolution_instance_id ??
        (instance as { id?: string } | undefined)?.id ??
        null;
      const evoStatus = (instance as { status?: string | null } | undefined)?.status ?? null;
      return {
        id: job.id,
        campaign_id: job.campaign_id ?? null,
        plan: job.maturation_plans,
        instance_name: instance?.instance_name || null,
        evolution_instance_id: evoId,
        instance_evolution_status: evoStatus,
        target_chat_id: job.target_chat_id,
        status: job.status,
        progress_total: job.progress_total,
        /** Enviados com sucesso (igual coluna progress_done após correção no processor) */
        progress_done: job.progress_done,
        progress_percent:
          job.progress_total > 0 ? Math.round((job.progress_done / job.progress_total) * 100) : 0,
        step_statuses: stepStatuses,
        steps_sent: stepsSent,
        steps_failed: stepsFailed,
        steps_pending: stepsPending,
        started_at: job.started_at,
        ended_at: job.ended_at,
        created_at: job.created_at,
        next_scheduled_at: nextScheduledByJob[job.id] || null,
        readonly_controls: false,
      };
    });
    
    return NextResponse.json({
      jobs: formattedJobs,
      total: formattedJobs.length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/jobs] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar jobs' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    const body = await req.json();
    const {
      plan_id,
      target_chat_id,
      use_virgin_messages,
      preferred_evolution_instance_ids,
      delay_seconds_override,
      use_tenant_default_mutual_plan,
    } = body;
    
    const useVirgin = use_virgin_messages === true;
    const useTenantDefault = use_tenant_default_mutual_plan === true;
    if (!useVirgin && !useTenantDefault && !plan_id) {
      return NextResponse.json(
        { error: 'plan_id é obrigatório, use use_virgin_messages: true ou use_tenant_default_mutual_plan: true' },
        { status: 400 }
      );
    }

    const result = await runMaturationStart(supabaseServiceRole, {
      userId,
      visibilityRequest: req,
      body: {
        plan_id,
        target_chat_id: target_chat_id || undefined,
        use_virgin_messages: useVirgin,
        preferred_evolution_instance_ids: Array.isArray(preferred_evolution_instance_ids)
          ? preferred_evolution_instance_ids
          : undefined,
        outbound_target_chat_ids: Array.isArray(body.outbound_target_chat_ids)
          ? (body.outbound_target_chat_ids as string[])
          : undefined,
        delay_seconds_override: delay_seconds_override != null ? Number(delay_seconds_override) : undefined,
        use_tenant_default_mutual_plan: useTenantDefault,
      },
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        job_id: result.job_id,
        job_ids: result.job_ids,
        campaign_id: result.campaign_id,
        master_instance: result.master_instance,
        master_instances: result.master_instances,
        total_steps: result.total_steps,
      });
    }

    return NextResponse.json(
      { error: result.error || 'Erro ao iniciar job' },
      { status: result.statusCode }
    );
  } catch (error: any) {
    console.error('[POST /api/maturation/jobs] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao criar job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

