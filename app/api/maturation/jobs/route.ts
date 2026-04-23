/**
 * API Route: /api/maturation/jobs
 *
 * GET: Lista apenas jobs do usuário autenticado.
 * POST: Cria novo job (chama Netlify Function maturation-start)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const JOB_DETAIL_SELECT = `
  *,
  maturation_plans (
    id,
    name,
    description
  ),
  master_instances (
    id,
    evolution_instances (
      instance_name
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

    const runningJobIds = mergedJobs.filter((j: any) => j.status === 'running').map((j: any) => j.id);
    let nextScheduledByJob: Record<string, string> = {};
    if (runningJobIds.length > 0) {
      const { data: pendingSteps } = await supabaseServiceRole
        .from('maturation_steps')
        .select('job_id, scheduled_at')
        .in('job_id', runningJobIds)
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
      return {
        id: job.id,
        campaign_id: job.campaign_id ?? null,
        plan: job.maturation_plans,
        instance_name: instance?.instance_name || null,
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
    const { plan_id, target_chat_id, use_virgin_messages, preferred_evolution_instance_ids, delay_seconds_override } = body;
    
    const useVirgin = use_virgin_messages === true;
    if (!useVirgin && !plan_id) {
      return NextResponse.json(
        { error: 'plan_id é obrigatório, ou use use_virgin_messages: true' },
        { status: 400 }
      );
    }
    
    // Em produção (Netlify) chama a função; em dev local chama a API interna (evita Invalid URL com path relativo)
    const netlifyBase = process.env.NETLIFY_FUNCTIONS_URL || process.env.NEXT_PUBLIC_NETLIFY_FUNCTIONS_URL || '';
    const useNetlifyFunction =
      netlifyBase &&
      (netlifyBase.startsWith('http://') || netlifyBase.startsWith('https://'));

    const payload: Record<string, unknown> = {
      target_chat_id: target_chat_id || undefined,
      preferred_evolution_instance_ids: Array.isArray(preferred_evolution_instance_ids) ? preferred_evolution_instance_ids : undefined,
      delay_seconds_override: delay_seconds_override != null ? Number(delay_seconds_override) : undefined,
    };
    if (useVirgin) {
      payload.use_virgin_messages = true;
    } else {
      payload.plan_id = plan_id;
    }

    let functionUrl: string;
    if (useNetlifyFunction) {
      functionUrl = `${netlifyBase.replace(/\/$/, '')}/maturation-start`;
    } else {
      const internalBase = process.env.INTERNAL_API_BASE_URL || 'http://localhost:3000';
      functionUrl = `${internalBase}/api/maturation/start`;
    }

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || 'Erro ao iniciar job' },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[POST /api/maturation/jobs] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao criar job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

