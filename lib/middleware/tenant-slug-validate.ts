import { getTenantByIdOrSlug } from '@/lib/services/zaploto-tenant-service';

const cache = new Map<string, { valid: boolean; exp: number }>();
const TTL_MS = 60_000;

/** Resolve se o slug corresponde a um tenant ativo (com TTL em memória). */
export async function isActiveTenantSlug(slug: string): Promise<boolean> {
  const lower = slug.trim().toLowerCase();
  if (!lower) return false;
  const now = Date.now();
  const hit = cache.get(lower);
  if (hit && hit.exp > now) return hit.valid;
  const tenant = await getTenantByIdOrSlug(lower);
  const valid = tenant != null;
  cache.set(lower, { valid, exp: now + TTL_MS });
  return valid;
}
