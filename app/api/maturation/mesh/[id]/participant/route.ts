/**
 * PATCH /api/maturation/mesh/[id]/participant
 * Body: { job_id: string, status: 'running' | 'paused' }
 *
 * Pausa ou retoma a participação de uma instância individual no ciclo mesh.
 * A instância sai (pausa) ou entra (retoma) sem parar o ciclo para as demais.
 * Apenas admin e super_admin podem usar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: controllerId } = await ctx.params;
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    // Apenas admin e super_admin podem pausar/retomar participação individual
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle();
    const profileStatus = String((profile as { status?: string } | null)?.status ?? '').toLowerCase();
    if (profileStatus !== 'admin' && profileStatus !== 'super_admin') {
      return NextResponse.json(
        { error: 'Apenas administrador ou super administrador pode alterar a participação no ciclo mesh.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { job_id, status } = body as { job_id?: string; status?: string };

    if (!job_id) return NextResponse.json({ error: 'job_id obrigatório' }, { status: 400 });
    if (status !== 'running' && status !== 'paused') {
      return NextResponse.json({ error: 'status deve ser running ou paused' }, { status: 400 });
    }

    // Verifica que o job pertence a esta campanha e não é o controller
    const { data: job } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id, campaign_id, mesh_is_controller')
      .eq('id', job_id)
      .maybeSingle();

    if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });

    // Confere que pertence ao controller informado
    const { data: ctrl } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('campaign_id')
      .eq('id', controllerId)
      .eq('mesh_is_controller', true)
      .maybeSingle();

    if (!ctrl || ctrl.campaign_id !== job.campaign_id) {
      return NextResponse.json({ error: 'Job não pertence a esta campanha' }, { status: 400 });
    }

    if (job.mesh_is_controller) {
      return NextResponse.json(
        { error: 'Use PATCH /api/maturation/mesh/[id] para pausar/retomar toda a campanha' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { status };
    if (status === 'running') {
      // Ao retomar, reseta o started_at para reiniciar o warmup de 5/15 min
      updates.started_at = new Date().toISOString();
    }

    await supabaseServiceRole.from('maturation_jobs').update(updates).eq('id', job_id);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
