/**
 * URL dos white labels: domínio padrão zaploto.com + slug como path.
 * Ex.: login central = zaploto.com/login | white label = zaploto.com/{slug}/login
 * Todas as URLs do sistema seguem zaploto.com/{slug}/...
 */

const BASE_DOMAIN = 'zaploto.com';
const BASE_URL = `https://${BASE_DOMAIN}`;

/** Domínio base (sempre zaploto.com). */
export function getZaplotoBaseDomain(): string {
  return BASE_DOMAIN;
}

/**
 * URL base do tenant: https://zaploto.com/{slug}
 * Não usa mais subdomínio; slug vai no path.
 */
export function getTenantBaseUrl(slug: string): string {
  const s = (slug ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!s) return BASE_URL;
  return `${BASE_URL}/${s}`;
}

/**
 * URL de uma rota do white label: https://zaploto.com/{slug}{path}
 * path deve começar com / (ex: /login, /admin).
 */
export function getTenantPathUrl(slug: string, path: string): string {
  const base = getTenantBaseUrl(slug);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** URL de login do white label: zaploto.com/{slug}/login */
export function getTenantLoginUrl(slug: string): string {
  return getTenantPathUrl(slug, '/login');
}

/**
 * URL de acesso ao white label (base para copiar/compartilhar).
 * Sempre usa zaploto.com/{slug}. Fallback sem slug: origin?zaploto_id= (compatibilidade).
 */
export function getTenantUrl(tenant: { id: string; slug?: string; domain?: string | null }): string {
  if (typeof window === 'undefined') return '';
  const slug = tenant.slug?.trim()?.toLowerCase().replace(/\s+/g, '-');
  if (slug) return getTenantBaseUrl(slug);
  return `${typeof window !== 'undefined' ? window.location.origin : ''}?zaploto_id=${tenant.id}`;
}

/**
 * Para compatibilidade: "domínio" do tenant no padrão path-based não é armazenado como antes.
 * Retorna null (não usamos mais campo domain para subdomínio).
 */
export function getTenantDomain(_slug: string): string | null {
  return null;
}
