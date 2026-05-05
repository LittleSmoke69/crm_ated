/** Nome do cookie do slug white label — sincronizado com middleware */
export const ZAPLOTO_SLUG_COOKIE = 'zaploto_slug';

/**
 * Rotas centrais ZapLoto (URL sem prefixo /slug): /login, /register, /forgot-password.
 * Não redirecionar para /{cookie}/login; branding usa tenant padrão, não o cookie WL.
 */
export const CENTRAL_ZAPLOTO_AUTH_FIRST_SEGMENTS = new Set([
  'login',
  'register',
  'forgot-password',
]);
