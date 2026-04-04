/**
 * GET /api/admin/maturation/jobs
 * Lista jobs de maturação ativos (running, paused, queued) de todos os usuários — painel admin.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdminMaturation(userId);

    const { searchParams } = new URL(req.url);
    const all = searchParams.get('all') === '1';

    let q = supabaseServiceRole.from('maturation_jobs').select(`
        id,
        owner_user_id,
        plan_id,
        master_instance_id,
        target_chat_id,
        status,
        progress_total,
        progress_done,
        started_at,
        created_at,
        maturation_plans ( name ),
        master_instances (
          evolution_instances ( instance_name )
        )
      `);

    if (!all) {
      q = q.in('status', ['running', 'paused', 'queued']);
    }

    const { data: jobs, error } = await q.order('started_at', { ascending: false, nullsFirst: false }).limit(200);

    if (error) {
      console.error('[admin/maturation/jobs]', error.message);
      return errorResponse('Erro ao listar jobs', 500);
    }

    const list = jobs || [];
    const ownerIds = [...new Set(list.map((j: { owner_user_id: string }) => j.owner_user_id).filter(Boolean))];
    const profileMap: Record<string, { full_name: string | null; email: string }> = {};

    if (ownerIds.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ownerIds);
      for (const p of profiles || []) {
        profileMap[p.id] = { full_name: p.full_name, email: p.email };
      }
    }

    const enriched = list.map((j: any) => {
      const ev = j.master_instances?.evolution_instances;
      const instName = Array.isArray(ev) ? ev[0]?.instance_name : ev?.instance_name;
      const owner = profileMap[j.owner_user_id];
      return {
        id: j.id,
        owner_user_id: j.owner_user_id,
        owner_label: owner ? `${owner.full_name || owner.email} (${owner.email})` : j.owner_user_id,
        plan_name: j.maturation_plans?.name || '—',
        instance_name: instName || '—',
        target_chat_id: j.target_chat_id,
        status: j.status,
        progress_total: j.progress_total,
        progress_done: j.progress_done,
        started_at: j.started_at,
        created_at: j.created_at,
      };
    });

    return successResponse({ jobs: enriched });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Acesso negado. Apenas administradores.') return errorResponse(msg, 403);
    if (msg === 'SERVICE_UNAVAILABLE') return errorResponse('Serviço temporariamente indisponível.', 503);
    return serverErrorResponse(e);
  }
}
