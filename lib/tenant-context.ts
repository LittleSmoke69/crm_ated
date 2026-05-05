/**
 * Contexto de tenant para isolamento white label.
 * URLs: central = zaploto.com/login | white label = zaploto.com/{slug}/login
 * O middleware define o cookie zaploto_slug quando o acesso é via /slug/...
 */

import { NextRequest } from 'next/server';
import { UserProfile } from './middleware/permissions';
import { getTenantByIdOrSlug } from './services/zaploto-tenant-service';
import { ZAPLOTO_SLUG_COOKIE } from '@/lib/constants/white-label';
import { RESERVED_FIRST_SEGMENTS } from '@/lib/middleware/reserved-first-segments';
import { getPathnameTenantSlug } from '@/lib/utils/white-label-path';

/** Tenant ZapLoto central; instâncias legadas podem ter `evolution_instances.zaploto_id` NULL (equivalente). */
export const ZAPLOTO_DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_ZAPLOTO_ID = ZAPLOTO_DEFAULT_TENANT_ID;

const ZAPLOTO_ID_HEADER = 'x-zaploto-id';
const ZAPLOTO_ID_QUERY = 'zaploto_id';
const ZAPLOTO_SLUG_HEADER_LOW = 'x-zaploto-slug';

/**
 * Slug WL para APIs que não passam pelo rewrite do middleware (/api/*).
 * Ordem: header explícito → slug na URL do Referer (`/{slug}/...`) → **não** usar cookie se o Referer
 * for rota central (/instances, /admin, …) para não misturar com cookie antigo de WL.
 */
function getSlugFromRequest(req: NextRequest): string {
  const headerSlug =
    req.headers.get(ZAPLOTO_SLUG_HEADER_LOW)?.trim().toLowerCase() ||
    req.headers.get('X-Zaploto-Slug')?.trim().toLowerCase() ||
    '';
  if (headerSlug) return headerSlug;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refPath = new URL(referer).pathname;
      const slugFromRef = getPathnameTenantSlug(refPath);
      if (slugFromRef) return slugFromRef;
      const first = refPath.split('/').filter(Boolean)[0]?.toLowerCase();
      if (first && RESERVED_FIRST_SEGMENTS.has(first)) {
        return '';
      }
    } catch {
      // ignore URL parse errors
    }
  }

  return req.cookies.get(ZAPLOTO_SLUG_COOKIE)?.value?.trim().toLowerCase() || '';
}

/**
 * Retorna o zaploto_id efetivo para a requisição.
 * - Cookie zaploto_slug (definido pelo middleware em zaploto.com/slug/...): resolve slug → tenant e usa se permitido
 * - Header X-Zaploto-Slug propagado pelo rewrite do middleware quando aplicável (fallback cookie)
 * - super_admin: header/query X-Zaploto-Id ou zaploto_id para acessar qualquer tenant
 * - outros: zaploto_id do perfil (ou do tenant do slug se pertencer a esse tenant)
 */
export async function getEffectiveZaplotoId(
  req: NextRequest,
  profile: UserProfile | null
): Promise<string> {
  const zaplotoIdFromProfile = profile?.zaploto_id || DEFAULT_ZAPLOTO_ID;

  /**
   * super_admin: `X-Zaploto-Id` / query (TenantSwitcher no admin) deve vir **antes** do slug
   * em Referer/cookie; caso contrário o cookie WL ou `/{slug}/admin` sobrescrevia a seleção do painel.
   */
  if (profile?.status === 'super_admin') {
    const header = req.headers.get(ZAPLOTO_ID_HEADER) || req.headers.get('X-Zaploto-Id');
    if (header?.trim()) return header.trim();
    const query = req.nextUrl.searchParams.get(ZAPLOTO_ID_QUERY);
    if (query?.trim()) return query.trim();
  }

  const slugEffective = getSlugFromRequest(req);

  if (slugEffective) {
    const tenant = await getTenantByIdOrSlug(slugEffective);
    if (tenant) {
      if (!profile) return tenant.id;
      if (profile.status === 'super_admin') return tenant.id;
      if ((profile.zaploto_id || DEFAULT_ZAPLOTO_ID) === tenant.id) return tenant.id;
    }
  }

  if (!profile) return DEFAULT_ZAPLOTO_ID;

  return zaplotoIdFromProfile;
}

/**
 * Escopo de `evolution_instances.zaploto_id` para listagem e criação no app do cliente.
 *
 * Cookie/referer/header WL podem alterar `getEffectiveZaplotoId` sem bater com `profiles.zaploto_id`,
 * fazendo a lista ficar vazia mesmo com instâncias criadas pelo usuário. Para cargos de operação
 * (gerente, consultor, dono_banca, etc.) usamos sempre o tenant do perfil.
 *
 * Painel global (super_admin, admin, auditoria) mantém o tenant efetivo da requisição (switcher / WL).
 */
export function getEvolutionInstancesZaplotoScopeId(params: {
  profile: UserProfile;
  effectiveZaplotoId: string;
  userStatus: string | null | undefined;
}): string {
  const s = String(params.userStatus ?? '')
    .trim()
    .toLowerCase();
  if (s === 'super_admin' || s === 'admin' || s === 'auditoria') {
    return params.effectiveZaplotoId;
  }
  return params.profile.zaploto_id || ZAPLOTO_DEFAULT_TENANT_ID;
}

/**
 * Verifica se o usuário pode acessar o tenant especificado.
 * super_admin: pode acessar qualquer tenant
 * outros: apenas o próprio tenant
 */
export function canAccessTenant(
  profile: UserProfile | null,
  targetZaplotoId: string
): boolean {
  if (!profile) return false;
  if (profile.status === 'super_admin') return true;
  return (profile.zaploto_id || DEFAULT_ZAPLOTO_ID) === targetZaplotoId;
}
