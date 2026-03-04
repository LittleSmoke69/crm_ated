/**
 * Middleware para white label: zaploto.com/{slug}/... → rewrite para /... e definir tenant pelo slug.
 * Central: zaploto.com/login, zaploto.com/admin, etc.
 * White label: zaploto.com/{slug}/login, zaploto.com/{slug}/admin, etc.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Primeiro segmento que são rotas do app (central). Não tratar como slug de tenant. */
const RESERVED_FIRST_SEGMENTS = new Set([
  'api',
  '_next',
  'favicon.ico',
  'login',
  'register',
  'forgot-password',
  'admin',
  'instances',
  'maturador',
  'ai-agents',
  'consultor',
  'gerente',
  'dono-banca',
  'gestor-trafego',
  'crm',
  'campanha',
  'campanhas',
  'add-to-group',
  'list-cleaning',
  'contacts',
  'import-contacts',
  'anti-spam',
  'chat',
  'perfil',
  'vsl',
  'r',
  'zl',   // Zaplink: /zl/[slug] (redirect) e /zl/form/[slug] (formulário)
  'academy',
]);

const ZAPLOTO_SLUG_COOKIE = 'zaploto_slug';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignorar API, _next e assets
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (!first) {
    // Path é exatamente /
    const res = NextResponse.next();
    res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
    return res;
  }

  if (RESERVED_FIRST_SEGMENTS.has(first)) {
    // Acesso central: /login, /admin, etc. — não definir slug
    const res = NextResponse.next();
    res.cookies.delete(ZAPLOTO_SLUG_COOKIE);
    return res;
  }

  // Primeiro segmento é slug do white label: /slug/... → rewrite para /...
  const rest = segments.slice(1);
  const newPath = rest.length > 0 ? `/${rest.join('/')}` : '/';
  const url = req.nextUrl.clone();
  url.pathname = newPath;

  const res = NextResponse.rewrite(url);
  res.cookies.set(ZAPLOTO_SLUG_COOKIE, first, { path: '/', maxAge: 60 * 60 * 24 * 7 }); // 7 dias
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|svg|woff2?)$).*)',
  ],
};
