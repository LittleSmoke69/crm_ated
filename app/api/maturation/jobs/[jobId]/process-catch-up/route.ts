/**
 * POST /api/maturation/jobs/[jobId]/process-catch-up
 *
 * Processa em segundo plano todos os steps atrasados do job (scheduled_at <= now).
 * Envia as mensagens direto para a Evolution API em lote e retorna sucesso/falha por step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runJobCatchUp } from '@/lib/services/maturation/processor';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    const { jobId } = await params;

    const { data: job } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id, owner_user_id, status')
      .eq('id', jobId)
      .eq('owner_user_id', userId)
      .single();

    if (!job) {
      return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
    }
    if (job.status !== 'running') {
      return NextResponse.json(
        { error: 'Só é possível processar atrasados de um job em execução' },
        { status: 400 }
      );
    }

    const result = await runJobCatchUp(supabaseServiceRole, jobId);
    return NextResponse.json({
      success: true,
      job_id: jobId,
      sent: result.sent,
      failed: result.failed,
      results: result.results,
    });
  } catch (error: any) {
    console.error('[POST /api/maturation/jobs/[jobId]/process-catch-up] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao processar atrasados' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
