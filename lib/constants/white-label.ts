/** Nome do cookie do slug white label — sincronizado com middleware */
export const ZAPLOTO_SLUG_COOKIE = 'zaploto_slug';

/**
 * Slug do tenant central (Zaploto Original). URLs públicas ficam na raiz do domínio
 * (`/crm`, `/instances`), nunca `/zaploto/crm`.
 */
export const CENTRAL_TENANT_SLUG = 'zaploto';

/** Slug do tenant central, em minúsculas — uso em comparações de path/cookie. */
export function isCentralTenantSlug(slug: string | null | undefined): boolean {
  if (!slug?.trim()) return false;
  return slug.trim().toLowerCase() === CENTRAL_TENANT_SLUG;
}

/**
 * Rotas centrais ZapLoto (URL sem prefixo /slug): /login, /register, /forgot-password.
 * Não redirecionar para /{cookie}/login; branding usa tenant padrão, não o cookie WL.
 */
export const CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS = new Set([
  'login',
  'register',
  'forgot-password',
]);
