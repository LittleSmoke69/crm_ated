/**
 * Contexto de tenant para isolamento white label.
 * URLs: central = zaploto.com/login | white label = zaploto.com/{slug}/login
 * O middleware define o cookie zaploto_slug quando o acesso é via /slug/...
 */

import { NextRequest } from 'next/server';
import { UserProfile } from './middleware/permissions';
import { getTenantByIdOrSlug } from './services/zaploto-tenant-service';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

const ZAPLOTO_ID_HEADER = 'x-zaploto-id';
const ZAPLOTO_ID_QUERY = 'zaploto_id';
const ZAPLOTO_SLUG_COOKIE = 'zaploto_slug';

/**
 * Retorna o zaploto_id efetivo para a requisição.
 * - Cookie zaploto_slug (definido pelo middleware em zaploto.com/slug/...): resolve slug → tenant e usa se permitido
 * - super_admin: header/query X-Zaploto-Id ou zaploto_id para acessar qualquer tenant
 * - outros: zaploto_id do perfil (ou do tenant do slug se pertencer a esse tenant)
 */
export async function getEffectiveZaplotoId(
  req: NextRequest,
  profile: UserProfile | null
): Promise<string> {
  const zaplotoIdFromProfile = profile?.zaploto_id || DEFAULT_ZAPLOTO_ID;

  const slugFromCookie = req.cookies.get(ZAPLOTO_SLUG_COOKIE)?.value?.trim();
  if (slugFromCookie) {
    const tenant = await getTenantByIdOrSlug(slugFromCookie);
    if (tenant) {
      if (!profile) return tenant.id;
      if (profile.status === 'super_admin') return tenant.id;
      if ((profile.zaploto_id || DEFAULT_ZAPLOTO_ID) === tenant.id) return tenant.id;
    }
  }

  if (!profile) return DEFAULT_ZAPLOTO_ID;

  if (profile.status === 'super_admin') {
    const header = req.headers.get(ZAPLOTO_ID_HEADER) || req.headers.get('X-Zaploto-Id');
    if (header?.trim()) return header.trim();
    const query = req.nextUrl.searchParams.get(ZAPLOTO_ID_QUERY);
    if (query?.trim()) return query.trim();
  }

  return zaplotoIdFromProfile;
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
