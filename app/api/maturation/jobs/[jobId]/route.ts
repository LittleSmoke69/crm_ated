/**
 * API Route: /api/maturation/jobs/[jobId]
 *
 * GET: Busca detalhes de um job específico
 * PATCH: Atualiza status do job (pause/resume/abort)
 * DELETE: Remove o job (e steps/mensagens em cascata); libera lock da instância mestre
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    const { jobId } = await params;
    
    // Busca job
    const { data: job, error } = await supabaseServiceRole
      .from('maturation_jobs')
      .select(`
        *,
        maturation_plans (
          id,
          name,
          description,
          steps_json
        ),
        master_instances (
          id,
          health_score,
          evolution_instances (
            instance_name,
            status
          )
        )
      `)
      .eq('id', jobId)
      .eq('owner_user_id', userId)
      .single();
    
    if (error || !job) {
      return NextResponse.json(
        { error: 'Job não encontrado' },
        { status: 404 }
      );
    }
    
    // Busca steps
    const { data: steps } = await supabaseServiceRole
      .from('maturation_steps')
      .select('*')
      .eq('job_id', jobId)
      .order('step_index', { ascending: true });
    
    // Formata resposta
    const instance = Array.isArray(job.master_instances?.evolution_instances)
      ? job.master_instances.evolution_instances[0]
      : job.master_instances?.evolution_instances;
    
    return NextResponse.json({
      id: job.id,
      plan: job.maturation_plans,
      instance: {
        name: instance?.instance_name || null,
        status: instance?.status || null,
        health_score: job.master_instances?.health_score || null,
      },
      target_chat_id: job.target_chat_id,
      status: job.status,
      progress_total: job.progress_total,
      progress_done: job.progress_done,
      progress_percent: job.progress_total > 0 
        ? Math.round((job.progress_done / job.progress_total) * 100)
        : 0,
      started_at: job.started_at,
      ended_at: job.ended_at,
      created_at: job.created_at,
      steps: steps || [],
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/jobs/[jobId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    const { jobId } = await params;
    const body = await req.json();
    const { status } = body;
    
    if (!status || !['paused', 'running', 'aborted'].includes(status)) {
      return NextResponse.json(
        { error: 'status inválido. Use: paused, running ou aborted' },
        { status: 400 }
      );
    }
    
    // Verifica se job pertence ao usuário
    const { data: job, error: jobError } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id, status, master_instance_id')
      .eq('id', jobId)
      .eq('owner_user_id', userId)
      .single();
    
    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Job não encontrado' },
        { status: 404 }
      );
    }
    
    // Atualiza status
    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    
    if (status === 'aborted') {
      updateData.ended_at = new Date().toISOString();
      
      // Libera lock da instância mestre
      await supabaseServiceRole
        .from('master_instances')
        .update({
          is_locked: false,
          locked_job_id: null,
          locked_at: null,
        })
        .eq('id', job.master_instance_id);
    }
    
    const { error: updateError } = await supabaseServiceRole
      .from('maturation_jobs')
      .update(updateData)
      .eq('id', jobId);
    
    if (updateError) {
      return NextResponse.json(
        { error: 'Erro ao atualizar job' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      job_id: jobId,
      status,
    });
  } catch (error: any) {
    console.error('[PATCH /api/maturation/jobs/[jobId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao atualizar job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    const { jobId } = await params;

    const { data: job, error: jobError } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id, master_instance_id')
      .eq('id', jobId)
      .eq('owner_user_id', userId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
    }

    await supabaseServiceRole
      .from('master_instances')
      .update({
        is_locked: false,
        locked_job_id: null,
        locked_at: null,
      })
      .eq('id', job.master_instance_id);

    const { error: delError } = await supabaseServiceRole.from('maturation_jobs').delete().eq('id', jobId);

    if (delError) {
      console.error('[DELETE /api/maturation/jobs/[jobId]] Erro:', delError);
      return NextResponse.json({ error: 'Erro ao remover job' }, { status: 500 });
    }

    return NextResponse.json({ success: true, job_id: jobId });
  } catch (error: any) {
    console.error('[DELETE /api/maturation/jobs/[jobId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao remover job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

