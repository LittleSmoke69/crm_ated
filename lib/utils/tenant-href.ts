'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS,
  isCentralTenantSlug,
  ZAPLOTO_SLUG_COOKIE,
} from '@/lib/constants/white-label';
import { RESERVED_FIRST_SEGMENTS } from '@/lib/middleware/reserved-first-segments';
import { getPathnameTenantSlug } from '@/lib/utils/white-label-path';

/** `/login`, `/register`, `/forgot-password` na URL central (sem slug no path). */
export function isCentralZaplotoAuthPath(pathname: string): boolean {
  const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return first ? CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS.has(first) : false;
}

export function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Slug ativo: primeiro segmento da URL quando é tenant (/suarifa/...); senão cookie.
 * Em /login, /register e /forgot-password centrais ignora o cookie — ZapLoto padrão.
 *
 * Importante: em rotas centrais do app (`/admin`, `/crm`, … — primeiro segmento reservado),
 * **não** usar o cookie WL. Caso contrário, após login em `/login` o push para `/admin` lia o
 * cookie de uma visita anterior e prefixava `/suarifa` incorretamente.
 */
export function getActiveTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  const fromPath = getPathnameTenantSlug(path);
  if (fromPath) return isCentralTenantSlug(fromPath) ? null : fromPath;
  if (isCentralZaplotoAuthPath(path)) {
    return null;
  }
  const first = path.split('/').filter(Boolean)[0]?.toLowerCase();
  if (first && RESERVED_FIRST_SEGMENTS.has(first)) {
    return null;
  }
  const c = readBrowserCookie(ZAPLOTO_SLUG_COOKIE)?.trim();
  if (!c || isCentralTenantSlug(c)) return null;
  return c.toLowerCase();
}

/** Remove o cookie de slug WL (ex.: após login na ZapLoto central). */
export function clearZaplotoSlugCookie() {
  if (typeof document === 'undefined') return;
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ZAPLOTO_SLUG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Headers para `fetch` em APIs que usam `getEffectiveZaplotoId` no servidor.
 * Envia `X-Zaploto-Slug` quando o pathname é `/{slug}/...` (white label no URL).
 * Em rotas centrais (/instances, /admin, …) não envia — o servidor usa Referer e ignora cookie WL antigo.
 */
export function getWlSlugHeadersForApi(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const slug = getPathnameTenantSlug(window.location.pathname);
  if (!slug) return {};
  return { 'X-Zaploto-Slug': slug };
}

/**
 * Prefixa rota absoluta interna com o slug quando em contexto white label.
 */
export function withTenantSlug(href: string, slugOverride?: string | null): string {
  let slug =
    slugOverride ??
    (typeof window !== 'undefined' ? getActiveTenantSlug() : null);
  if (!slug?.trim() || isCentralTenantSlug(slug)) return href;
  slug = slug.trim().toLowerCase();
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (href.startsWith('/#')) return href;
  // Painel administrativo sempre na ZapLoto central (sem prefixo WL).
  if (href === '/admin' || href.startsWith('/admin/')) return href;

  const parts = href.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === slug) return href;

  const path = href === '/' ? '' : href;
  return `/${slug}${path}`;
}

export function useTenantHref() {
  const pathname = usePathname();
  const slugFromRouter = pathname ? getPathnameTenantSlug(pathname) : null;

  return useCallback(
    (href: string) => withTenantSlug(href, slugFromRouter ?? undefined),
    [slugFromRouter]
  );
}

/** Mesmo que `useRouter`, mas `push`/`replace` prefixam o slug do white label em rotas internas. */
export function useTenantRouter() {
  const router = useRouter();
  const to = useTenantHref();

  return useMemo(
    () => ({
      ...router,
      push: (href: Parameters<typeof router.push>[0], options?: Parameters<typeof router.push>[1]) => {
        if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
          return router.push(to(href), options);
        }
        return router.push(href, options);
      },
      replace: (href: Parameters<typeof router.replace>[0], options?: Parameters<typeof router.replace>[1]) => {
        if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
          return router.replace(to(href), options);
        }
        return router.replace(href, options);
      },
    }),
    [router, to]
  );
}
