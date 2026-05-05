/**
 * Segmentos da URL central (nunca são slug de tenant).
 * Deve ficar sincronizado com a lógica em middleware.ts e tenant-href.
 * Nota: rotas /academy centrais são tratadas em middleware.ts antes da lista (primeiro segmento "academy").
 */
export const RESERVED_FIRST_SEGMENTS = new Set([
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
  'chat-atendimento',
  'perfil',
  'vsl',
  'r',
  'zl',
]);
