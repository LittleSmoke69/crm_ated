import { RESERVED_FIRST_SEGMENTS } from '@/lib/middleware/reserved-first-segments';

/** Primeiro segmento da URL é slug de tenant? */
export function getPathnameTenantSlug(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean);
  const first = seg[0]?.toLowerCase();
  if (!first || RESERVED_FIRST_SEGMENTS.has(first)) return null;
  return first;
}

/**
 * Pathname interno do app sem o prefixo do tenant (rewrite).
 * Ex.: /banca/admin/meta -> /admin/meta ; /login -> /login ; /foo -> /
 */
export function getInternalAppPathname(pathname: string | null | undefined): string {
  if (!pathname || pathname === '/') return '/';
  const slug = getPathnameTenantSlug(pathname);
  if (!slug) return pathname;
  const trimmed = pathname.replace(new RegExp(`^/${slug}(?=/|$)`, 'i'), '') || '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
