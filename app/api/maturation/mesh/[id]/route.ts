/**
 * PATCH /api/maturation/mesh/[id]
 *   Body: { status?: 'running' | 'paused' | 'aborted', cycle_interval_sec?: number }
 *   - status='paused' interrompe os ciclos (steps já criados continuam até o claim ver paused).
 *   - status='running' retoma os ciclos.
 *   - status='aborted' encerra definitivamente todos os jobs da campanha.
 *   - cycle_interval_sec atualiza o intervalo do loop.
 *
 * DELETE /api/maturation/mesh/[id]
 *   Aborta a campanha e remove todos os jobs/steps associados.
 *
 * O [id] é o controller_job_id (não o campaign_id) — controle vai sempre pelo controller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const MESH_MIN_INTERVAL_SEC = 5;
const MESH_MAX_INTERVAL_SEC = 3600;

async function loadController(controllerId: string) {
  const { data, error } = await supabaseServiceRole
    .from('maturation_jobs')
    .select('id, owner_user_id, campaign_id, mesh_is_controller, status, mesh_cycle_interval_sec')
    .eq('id', controllerId)
    .maybeSingle();
  if (error || !data) return { error: 'Campanha não encontrada', status: 404 };
  if (!data.mesh_is_controller) return { error: 'Job não é controller mesh', status: 400 };
  return { controller: data };
}

async function assertMeshLifecycleAdmin(userId: string): Promise<NextResponse | null> {
  const { data: row } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .maybeSingle();
  const s = String((row as { status?: string } | null)?.status ?? '').toLowerCase();
  if (s !== 'admin' && s !== 'super_admin') {
    return NextResponse.json(
      {
        error:
          'Apenas administrador ou super administrador pode pausar, retomar, encerrar o mesh ou alterar o intervalo entre ciclos.',
      },
      { status: 403 }
    );
  }
  return null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: controllerId } = await ctx.params;
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const forbidden = await assertMeshLifecycleAdmin(userId);
    if (forbidden) return forbidden;

    const loaded = await loadController(controllerId);
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const ctrl = loaded.controller as any;

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body.cycle_interval_sec != null) {
      const n = Number(body.cycle_interval_sec);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'cycle_interval_sec inválido' }, { status: 400 });
      }
      const clamped = Math.max(MESH_MIN_INTERVAL_SEC, Math.min(MESH_MAX_INTERVAL_SEC, Math.round(n)));
      updates.mesh_cycle_interval_sec = clamped;
    }

    if (body.status) {
      const newStatus = String(body.status);
      if (!['running', 'paused', 'aborted'].includes(newStatus)) {
        return NextResponse.json({ error: 'status inválido' }, { status: 400 });
      }
      updates.status = newStatus;
      if (newStatus === 'aborted') {
        updates.ended_at = new Date().toISOString();
      } else if (newStatus === 'running') {
        // Ao retomar, agenda próximo ciclo pra agora (ou já-passado, pra disparar no próximo tick)
        updates.mesh_next_cycle_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada a atualizar' }, { status: 400 });
    }

    // Aplica em todos os jobs da campanha quando status muda; campos mesh_* só no controller
    if (updates.status) {
      const allUpdates = { status: updates.status, ...(updates.ended_at ? { ended_at: updates.ended_at } : {}) };
      await supabaseServiceRole
        .from('maturation_jobs')
        .update(allUpdates)
        .eq('campaign_id', ctrl.campaign_id);
    }

    // Campos mesh_* só no controller
    const ctrlUpdates: Record<string, unknown> = {};
    if (updates.mesh_cycle_interval_sec != null) ctrlUpdates.mesh_cycle_interval_sec = updates.mesh_cycle_interval_sec;
    if (updates.mesh_next_cycle_at != null) ctrlUpdates.mesh_next_cycle_at = updates.mesh_next_cycle_at;
    if (Object.keys(ctrlUpdates).length > 0) {
      await supabaseServiceRole.from('maturation_jobs').update(ctrlUpdates).eq('id', controllerId);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: controllerId } = await ctx.params;
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const loaded = await loadController(controllerId);
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const ctrl = loaded.controller as any;

    const ownerUserId = ctrl.owner_user_id as string | null | undefined;
    const idsForProfiles = [...new Set([userId, ownerUserId].filter(Boolean))] as string[];
    const { data: profRows } = await supabaseServiceRole.from('profiles').select('id, status').in('id', idsForProfiles);
    const statusById = new Map((profRows || []).map((p: { id: string; status?: string }) => [p.id, String(p.status || '')]));
    const viewerIsSuperAdmin = statusById.get(userId) === 'super_admin';
    const ownerIsSuperAdmin =
      !!ownerUserId && statusById.get(String(ownerUserId)) === 'super_admin';
    if (ownerIsSuperAdmin && !viewerIsSuperAdmin) {
      return NextResponse.json(
        { error: 'Esta malha foi criada por um super administrador. Apenas super administrador pode remover.' },
        { status: 403 }
      );
    }

    // Marca todos como aborted antes de deletar (limpa locks, libera instâncias)
    await supabaseServiceRole
      .from('maturation_jobs')
      .update({ status: 'aborted', ended_at: new Date().toISOString() })
      .eq('campaign_id', ctrl.campaign_id);

    // Deleta jobs (cascade deleta steps e messages via FK)
    await supabaseServiceRole.from('maturation_jobs').delete().eq('campaign_id', ctrl.campaign_id);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
