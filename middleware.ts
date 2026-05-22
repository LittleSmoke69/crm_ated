/**
 * Middleware para white label: zaploto.com/{slug}/... → rewrite para /... e definir tenant pelo slug.
 * URLs centrais (/login, /register, …) não são redirecionadas pelo cookie — ficam no ZapLoto padrão.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  CENTRAL_TENANT_SLUG,
  CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS,
  isCentralTenantSlug,
  ZAPLOTO_SLUG_COOKIE,
} from '@/lib/constants/white-label';
import {
  isLegacyUserIdAuthAllowed,
  readSessionUserIdFromRequest,
} from '@/lib/server/session-token';
import { RESERVED_FIRST_SEGMENTS } from '@/lib/middleware/reserved-first-segments';
import { isActiveTenantSlug } from '@/lib/middleware/tenant-slug-validate';

const SLUG_COOKIE_OPTIONS = {
  path: '/' as const,
  maxAge: 60 * 60 * 24 * 7,
  sameSite: 'lax' as const,
  httpOnly: false,
};

/** Sem redirect cookie→/{slug}/…: Zaplink, redirects curtos, auth central ZapLoto. */
const RESERVED_SKIP_TENANT_REDIRECT = new Set([
  'zl',
  'r',
  'admin',
  ...CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS,
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.includes('.')) {
    if (pathname.startsWith('/api/admin')) {
      const sessionUser = await readSessionUserIdFromRequest(req);
      if (!sessionUser && !isLegacyUserIdAuthAllowed()) {
        return NextResponse.json(
          { success: false, error: 'Não autenticado' },
          { status: 401 }
        );
      }
    }
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (!first) {
    return NextResponse.next();
  }

  /** Rotas públicas /academy e subrotas na URL central (sem prefixo de tenant). */
  if (first === 'academy') {
    return NextResponse.next();
  }

  /**
   * Blindagem: admin é sempre central.
   * Ex.: /{slug}/admin/... -> /admin/...
   */
  const second = segments[1]?.toLowerCase();
  if (second === 'admin' && (await isActiveTenantSlug(first))) {
    const restAdmin = segments.slice(2);
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = restAdmin.length > 0 ? `/admin/${restAdmin.join('/')}` : '/admin';
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
    return res;
  }

  if (RESERVED_FIRST_SEGMENTS.has(first)) {
    if (RESERVED_SKIP_TENANT_REDIRECT.has(first)) {
      return NextResponse.next();
    }
    const slugFromCookie = req.cookies.get(ZAPLOTO_SLUG_COOKIE)?.value?.trim();
    if (!slugFromCookie || isCentralTenantSlug(slugFromCookie)) {
      const res = NextResponse.next();
      if (slugFromCookie && isCentralTenantSlug(slugFromCookie)) {
        res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
      }
      return res;
    }
    const normalized = slugFromCookie.toLowerCase();
    const validSlug = await isActiveTenantSlug(normalized);
    if (!validSlug) {
      const res = NextResponse.next();
      res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
      return res;
    }
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = `/${normalized}${pathname}`;
    return NextResponse.redirect(redirectUrl);
  }

  /** Tenant central: canonical na raiz (`/crm`), não `/zaploto/crm`. */
  if (first === CENTRAL_TENANT_SLUG && (await isActiveTenantSlug(first))) {
    const restCentral = segments.slice(1);
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = restCentral.length > 0 ? `/${restCentral.join('/')}` : '/';
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
    return res;
  }

  if (!(await isActiveTenantSlug(first))) {
    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
    return res;
  }

  const rest = segments.slice(1);
  const newPath = rest.length > 0 ? `/${rest.join('/')}` : '/';
  const url = req.nextUrl.clone();
  url.pathname = newPath;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-zaploto-slug', first);

  const res = NextResponse.rewrite(url, {
    request: {
      headers: requestHeaders,
    },
  });

  res.cookies.set(ZAPLOTO_SLUG_COOKIE, first, SLUG_COOKIE_OPTIONS);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|svg|woff2?)$).*)',
  ],
};
