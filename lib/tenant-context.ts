/**
 * Contexto de tenant para isolamento white label.
 * Cada tenant tem dados isolados. Apenas super_admin pode acessar qualquer tenant.
 */

import { NextRequest } from 'next/server';
import { UserProfile } from './middleware/permissions';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/** Headers/params que super_admin pode usar para "entrar" em um tenant */
const ZAPLOTO_ID_HEADER = 'x-zaploto-id';
const ZAPLOTO_ID_QUERY = 'zaploto_id';

/**
 * Retorna o zaploto_id efetivo para a requisição.
 * - super_admin: pode passar X-Zaploto-Id ou ?zaploto_id= para acessar qualquer tenant
 * - outros: sempre usam o zaploto_id do próprio perfil (isolamento total)
 */
export function getEffectiveZaplotoId(
  req: NextRequest,
  profile: UserProfile | null
): string {
  const zaplotoIdFromProfile = profile?.zaploto_id || DEFAULT_ZAPLOTO_ID;

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
