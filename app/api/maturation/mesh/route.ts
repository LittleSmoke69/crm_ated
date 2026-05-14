/**
 * POST /api/maturation/mesh
 *
 * Inicia uma campanha mesh contínua. Cria 1 job por instância participante (mesmo campaign_id),
 * marca o primeiro como controller e dispara o sinal inicial. O processor roda os ciclos
 * subsequentes via processMeshCycles() a cada cycle_interval_sec segundos.
 *
 * GET /api/maturation/mesh
 *
 * Lista campanhas mesh do usuário (apenas controllers, com seu estado de ciclo).
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMeshStart } from '@/lib/services/maturation/start-job';
import { runMaturationTick } from '@/lib/services/maturation/processor';

/** Permite que after() processe o tick após a resposta (até 60s). */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.participant_evolution_instance_ids)
      ? body.participant_evolution_instance_ids.map((x: unknown) => String(x ?? '')).filter(Boolean)
      : [];

    const result = await runMeshStart(supabaseServiceRole, {
      userId,
      visibilityRequest: req,
      body: {
        participant_evolution_instance_ids: ids,
        cycle_interval_sec:
          body.cycle_interval_sec != null ? Number(body.cycle_interval_sec) : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
      },
    });

    if (result.success) {
      // Dispara o tick imediatamente após a resposta para processar o disparo inicial
      // sem bloquear o cliente. Sem isso, os steps ficam aguardando o cron externo.
      after(async () => {
        try {
          await runMaturationTick(supabaseServiceRole);
        } catch (e) {
          console.error('[MESH] Erro no tick inicial pós-start:', e instanceof Error ? e.message : e);
        }
      });

      return NextResponse.json({
        success: true,
        campaign_id: result.campaign_id,
        controller_job_id: result.controller_job_id,
        job_ids: result.job_ids,
        participants: result.participants,
        cycle_interval_sec: result.cycle_interval_sec,
      });
    }

    return NextResponse.json({ error: result.error }, { status: result.statusCode });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao iniciar mesh';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    // Mesh é singleton global: qualquer usuário autenticado vê os mesmos controllers.
    const { data, error } = await supabaseServiceRole
      .from('maturation_jobs')
      .select(
        `id, campaign_id, status, owner_user_id, started_at, ended_at,
         mesh_cycle_interval_sec, mesh_cycle_count, mesh_next_cycle_at,
         mesh_last_sender_master_ids,
         master_instance_id`
      )
      .eq('mesh_is_controller', true)
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const controllers = data || [];
    if (controllers.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    const ownerUserIds = [
      ...new Set(
        controllers.map((c: { owner_user_id?: string | null }) => c.owner_user_id).filter(Boolean) as string[]
      ),
    ];
    const ownerStatusByUserId = new Map<string, string>();
    if (ownerUserIds.length > 0) {
      const { data: ownerProfiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, status')
        .in('id', ownerUserIds);
      for (const p of ownerProfiles || []) {
        ownerStatusByUserId.set(String((p as { id: string }).id), String((p as { status?: string }).status || ''));
      }
    }

    const campaignIds = controllers.map((c: any) => c.campaign_id).filter(Boolean) as string[];
    const { data: allJobs } = await supabaseServiceRole
      .from('maturation_jobs')
      .select(
        `id, campaign_id, master_instance_id, progress_total, progress_done, status, started_at, mesh_is_controller,
         master_instances:master_instance_id (
           group_msg_next_at,
           evolution_instances:evolution_instance_id ( id, instance_name, phone_number, status )
         )`
      )
      .in('campaign_id', campaignIds);

    const byCampaign = new Map<string, any[]>();
    for (const j of (allJobs || []) as any[]) {
      const arr = byCampaign.get(j.campaign_id) || [];
      arr.push(j);
      byCampaign.set(j.campaign_id, arr);
    }

    const campaigns = controllers.map((c: any) => {
      const jobs = byCampaign.get(c.campaign_id) || [];
      const totalSent = jobs.reduce((s, j) => s + (j.progress_done || 0), 0);
      const totalScheduled = jobs.reduce((s, j) => s + (j.progress_total || 0), 0);
      const participants = jobs.map((j) => {
        const mi = Array.isArray(j.master_instances) ? j.master_instances[0] : j.master_instances;
        const ei = mi
          ? Array.isArray(mi.evolution_instances)
            ? mi.evolution_instances[0]
            : mi.evolution_instances
          : null;
        return {
          job_id: j.id,
          master_instance_id: j.master_instance_id,
          instance_name: ei?.instance_name ?? null,
          phone_number: ei?.phone_number ?? null,
          status: ei?.status ?? null,
          job_status: j.status ?? 'running',
          started_at: j.started_at ?? null,
          is_controller: !!j.mesh_is_controller,
          progress_done: j.progress_done || 0,
          progress_total: j.progress_total || 0,
          group_msg_next_at: mi?.group_msg_next_at ?? null,
        };
      });
      const ownerId = c.owner_user_id ? String(c.owner_user_id) : '';
      const ownerStatus = ownerId ? ownerStatusByUserId.get(ownerId) : undefined;
      const created_by_super_admin = ownerStatus === 'super_admin';

      return {
        controller_job_id: c.id,
        campaign_id: c.campaign_id,
        status: c.status,
        created_by_super_admin,
        cycle_interval_sec: c.mesh_cycle_interval_sec,
        cycle_count: c.mesh_cycle_count,
        next_cycle_at: c.mesh_next_cycle_at,
        last_sender_master_ids: c.mesh_last_sender_master_ids || [],
        started_at: c.started_at,
        ended_at: c.ended_at,
        total_sent: totalSent,
        total_scheduled: totalScheduled,
        participants,
      };
    });

    return NextResponse.json({ campaigns });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao listar mesh';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
