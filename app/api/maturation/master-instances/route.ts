/**
 * API Route: /api/maturation/master-instances
 *
 * GET: Lista instâncias do tenant para o Maturador (conectadas e desconectadas).
 *
 * - instances: instâncias ativas (`is_active !== false`) visíveis ao perfil; inclui **desconectadas**
 *   (ex.: connection closed na Evolution) para a lista refletir queda de sessão;
 *   `available` / mesh continuam usando só as conectadas com telefone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { reconcileOrphanedMasterInstanceLocks } from '@/lib/maturation/reconcile-master-instance-locks';
import { evolutionMaturationDbStatusIsConnected } from '@/lib/utils/evolution-instance-status';
import {
  applyEvolutionInstancesVisibilityFilters,
  resolveEvolutionMaturationVisibilityScope,
  scopeForMaturationTenantWideInstanceList,
  evolutionInstanceEligibleForMaturationStart,
} from '@/lib/server/evolution-maturation-visibility';

const isConnectedStatus = (status: string | null) => evolutionMaturationDbStatusIsConnected(status);

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

const EVOLUTION_SELECT = `
  id,
  user_id,
  instance_name,
  status,
  is_master,
  is_active,
  phone_number,
  blocked_from_maturation,
  evolution_apis ( is_blocked_for_instances )
`;

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const scope = await resolveEvolutionMaturationVisibilityScope(supabaseServiceRole, req, userId);
    if (!scope) {
      return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 });
    }

    const maxRetries = 3;
    let allInstances: any[] | null = null;
    let connError: any = null;

    const listScope = scopeForMaturationTenantWideInstanceList(scope);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let query = supabaseServiceRole.from('evolution_instances').select(EVOLUTION_SELECT);
      query = applyEvolutionInstancesVisibilityFilters(query, listScope);
      // Mesma regra da lista em GET /api/instances: excluir só arquivadas (is_active === false);
      // is_active null/true seguem visíveis para não “sumir” instâncias ok legadas.
      const result = await query.order('is_master', { ascending: false }).order('instance_name', { ascending: true });

      connError = result.error;
      if (!connError) {
        const raw = result.data || [];
        const apisBlocked = (row: any) => {
          const apis = row.evolution_apis;
          if (!apis) return false;
          const api = Array.isArray(apis) ? apis[0] : apis;
          return api?.is_blocked_for_instances === true || api?.is_blocked_for_instances === 'true';
        };
        // Inclui desconectadas (ex.: status disconnected após connection closed no maturador)
        // para o operador ver na lista e reconectar — não filtrar por evolutionMaturationDbStatusIsConnected aqui.
        allInstances = raw.filter((row: any) => row?.is_active !== false && !apisBlocked(row));
        break;
      }
      if (isNetworkError(connError) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    if (connError) {
      console.error('[GET /api/maturation/master-instances] Erro evolution_instances:', connError.message || connError);
      return NextResponse.json(
        { instances: [], total: 0, available: 0, masterTotal: 0, _error: 'Serviço temporariamente indisponível. Tente novamente.' },
        { status: 200 }
      );
    }

    await reconcileOrphanedMasterInstanceLocks(supabaseServiceRole);

    const { data: masterRows } = await supabaseServiceRole
      .from('master_instances')
      .select('id, evolution_instance_id, is_active, is_locked, locked_job_id')
      .eq('is_active', true);

    const masterIdByEvolutionId = new Map<string, string>();
    (masterRows || []).forEach((row: any) => {
      masterIdByEvolutionId.set(row.evolution_instance_id, row.id);
    });

    const masterIds = (masterRows || []).map((r: any) => r.id).filter(Boolean);
    /** Vários jobs podem usar o mesmo master — is_locked na UI = “há maturação ativa”, não trava exclusiva. */
    const activeMaturationByMasterId = new Map<string, { count: number; meshCampaignId: string | null }>();
    if (masterIds.length > 0) {
      const { data: activeJobs } = await supabaseServiceRole
        .from('maturation_jobs')
        .select('master_instance_id, campaign_id')
        .in('master_instance_id', masterIds)
        .in('status', ['queued', 'running', 'paused']);
      for (const j of activeJobs || []) {
        const mid = j.master_instance_id as string;
        const cur = activeMaturationByMasterId.get(mid) || { count: 0, meshCampaignId: null as string | null };
        cur.count += 1;
        if (j.campaign_id && !cur.meshCampaignId) cur.meshCampaignId = j.campaign_id as string;
        activeMaturationByMasterId.set(mid, cur);
      }
    }

    const instances = (allInstances || []).map((ei: any) => {
      const status = ei.status || null;
      const inMaturador = masterIdByEvolutionId.has(ei.id);
      const masterId = masterIdByEvolutionId.get(ei.id);
      const act = masterId ? activeMaturationByMasterId.get(masterId) : undefined;
      const hasActiveMaturation = (act?.count ?? 0) > 0;
      const campaignId = act?.meshCampaignId ?? null;
      const is_locked = hasActiveMaturation;
      const isMaster = !!ei.is_master;
      const connected = isConnectedStatus(status);
      const hasPhoneNumber = !!(ei.phone_number && String(ei.phone_number).trim());
      const blockedFromMaturation = ei.blocked_from_maturation === true;
      const canStartMaturation = evolutionInstanceEligibleForMaturationStart(scope, {
        id: ei.id,
        user_id: ei.user_id ?? null,
      });
      const available =
        connected && hasPhoneNumber && !blockedFromMaturation && canStartMaturation;
      return {
        id: inMaturador ? (masterRows?.find((r: any) => r.evolution_instance_id === ei.id)?.id ?? null) : null,
        evolution_instance_id: ei.id,
        instance_name: ei.instance_name,
        phone_number: ei.phone_number || null,
        user_id: ei.user_id ?? null,
        status,
        is_master: !!ei.is_master,
        is_locked,
        available,
        has_phone_number: hasPhoneNumber,
        blocked_from_maturation: blockedFromMaturation,
        can_start_maturation: canStartMaturation,
        campaign_id: campaignId,
        campaign_status_label: campaignId ? 'em_campanha' : hasActiveMaturation ? 'em_maturacao' : 'sem_campanha',
        source: inMaturador ? 'master_instances' : 'evolution_instances',
      };
    });

    const availableCount = instances.filter((i: any) => i.available).length;
    const connectedCount = instances.filter((i: any) => isConnectedStatus(i.status)).length;

    return NextResponse.json({
      instances,
      total: instances.length,
      connected: connectedCount,
      available: availableCount,
      masterTotal: instances.filter((i: any) => i.is_master).length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/master-instances] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar instâncias' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
