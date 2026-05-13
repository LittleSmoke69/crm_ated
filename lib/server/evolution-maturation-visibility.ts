/**
 * Mesma regra de visibilidade de GET /api/instances para `evolution_instances`:
 * - super_admin: todas (sem filtro de tenant nem user_id)
 * - admin: todas do tenant efetivo (WL / switcher)
 * - dono_banca / gerente: próprias + subordinados (+ compartilhadas / atendimento para gerente)
 * - demais: próprias + compartilhadas
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserProfile, getSubordinates, type UserProfile } from '@/lib/middleware/permissions';
import {
  getEffectiveZaplotoId,
  getEvolutionInstancesZaplotoScopeId,
  ZAPLOTO_DEFAULT_TENANT_ID,
} from '@/lib/tenant-context';

export type EvolutionMaturationVisibilityScope = {
  profile: UserProfile;
  /** admin ou super_admin: mesma convenção de /api/instances (sem filtro user_id na query base). */
  bypassUserIdFilter: boolean;
  isSuperAdmin: boolean;
  effectiveZaplotoId: string;
  instancesZaplotoScopeId: string;
  allowedUserIds: string[];
  sharedInstanceIdArr: string[];
};

/**
 * Resolve escopo para filtrar `evolution_instances` igual à lista de Instâncias.
 * `req` pode ser um `NextRequest` sintético (ex.: Netlify) com os headers do cliente.
 */
export async function resolveEvolutionMaturationVisibilityScope(
  supabase: SupabaseClient,
  req: NextRequest,
  userId: string
): Promise<EvolutionMaturationVisibilityScope | null> {
  const fullProfile = await getUserProfile(userId);
  if (!fullProfile) return null;

  const effectiveZaplotoId = await getEffectiveZaplotoId(req, fullProfile);
  const userStatus = fullProfile.status;
  const isSuperAdmin = userStatus === 'super_admin';
  const isAdmin = userStatus === 'admin' || isSuperAdmin;
  const isDonoBanca = userStatus === 'dono_banca';
  const isGerente = userStatus === 'gerente';

  const instancesZaplotoScopeId = getEvolutionInstancesZaplotoScopeId({
    profile: fullProfile,
    effectiveZaplotoId,
    userStatus,
  });

  const { data: shareRowsForMe } = await supabase
    .from('evolution_instance_shared_users')
    .select('evolution_instance_id')
    .eq('user_id', userId);
  const sharedWithMeIds = new Set(
    (shareRowsForMe || []).map((r: { evolution_instance_id: string }) => r.evolution_instance_id)
  );

  let allowedUserIds: string[] = [userId];
  if (isDonoBanca || isGerente) {
    const subordinates = await getSubordinates(userId);
    const subordinateIds = subordinates.map((s) => s.id);
    allowedUserIds = [userId, ...subordinateIds];
  }

  const instanceIdsForOrFilter = new Set<string>(sharedWithMeIds);
  if (isGerente) {
    const { data: gerenteAssignRows } = await supabase
      .from('atendimento_chat_assignments')
      .select('evolution_instance_id')
      .eq('gerente_user_id', userId);
    for (const r of gerenteAssignRows || []) {
      const eid = (r as { evolution_instance_id?: string | null }).evolution_instance_id;
      if (typeof eid === 'string' && eid.length > 0) instanceIdsForOrFilter.add(eid);
    }
  }

  const sharedInstanceIdArr = Array.from(instanceIdsForOrFilter);

  return {
    profile: fullProfile,
    bypassUserIdFilter: isAdmin,
    isSuperAdmin,
    effectiveZaplotoId,
    instancesZaplotoScopeId,
    allowedUserIds,
    sharedInstanceIdArr,
  };
}

/** Aplica filtros de tenant + user/compartilhamento em um builder já em `.from('evolution_instances')`. */
export function applyEvolutionInstancesVisibilityFilters(query: any, scope: EvolutionMaturationVisibilityScope): any {
  let q = query;

  if (!scope.isSuperAdmin) {
    if (scope.instancesZaplotoScopeId === ZAPLOTO_DEFAULT_TENANT_ID) {
      q = q.or(`zaploto_id.eq.${ZAPLOTO_DEFAULT_TENANT_ID},zaploto_id.is.null`);
    } else {
      q = q.eq('zaploto_id', scope.instancesZaplotoScopeId);
    }
  }

  if (!scope.bypassUserIdFilter) {
    if (scope.sharedInstanceIdArr.length > 0) {
      q = q.or(`user_id.in.(${scope.allowedUserIds.join(',')}),id.in.(${scope.sharedInstanceIdArr.join(',')})`);
    } else {
      q = q.in('user_id', scope.allowedUserIds);
    }
  }

  return q;
}

/**
 * Lista do Maturador (GET /api/maturation/master-instances): instâncias ativas do **tenant**
 * (conectadas e desconectadas), para o operador ver quedas de sessão; elegibilidade ao Start segue `available`.
 * Mesmo escopo de tenant que um admin enxerga (`zaploto_id` / instâncias compartilhadas) — sem filtrar só por dono.
 * O **Start** continua limitado a `evolutionInstanceEligibleForMaturationStart` com o escopo original.
 */
export function scopeForMaturationTenantWideInstanceList(
  scope: EvolutionMaturationVisibilityScope
): EvolutionMaturationVisibilityScope {
  if (scope.isSuperAdmin) return scope;
  return { ...scope, bypassUserIdFilter: true };
}

/**
 * Pode criar job / entrar no Start: mesma regra da lista de Instâncias para não-admin
 * (próprias + compartilhadas + vínculos de gerente em `sharedInstanceIdArr`).
 */
export function evolutionInstanceEligibleForMaturationStart(
  scope: EvolutionMaturationVisibilityScope,
  row: { id: string; user_id?: string | null }
): boolean {
  if (scope.bypassUserIdFilter) return true;
  const uid = row.user_id != null ? String(row.user_id) : '';
  if (scope.allowedUserIds.includes(uid)) return true;
  if (scope.sharedInstanceIdArr.includes(row.id)) return true;
  return false;
}
