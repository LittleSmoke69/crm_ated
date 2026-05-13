/**
 * Normalização de evolution_instances.status para lista/cards e filtros.
 * No banco costuma ser `ok` quando conectado; a API pública traduz para `connected`.
 */

/** Status bruto no Postgres / admin — considera conectado. */
export function evolutionDbStatusIsConnected(dbStatus: unknown): boolean {
  const s = String(dbStatus ?? '').trim().toLowerCase();
  return s === 'ok' || s === 'connected';
}

/** Valor enviado pelo GET /api/instances (cards do app). */
export function evolutionDbStatusToPublicListUi(dbStatus: unknown): 'connected' | 'disconnected' {
  return evolutionDbStatusIsConnected(dbStatus) ? 'connected' : 'disconnected';
}

/** Filtros/contagens na UI após GET /api/instances (`connected` ou legado `ok`). */
export function instanceListUiStatusIsConnected(uiStatus: unknown): boolean {
  const s = String(uiStatus ?? '').trim().toLowerCase();
  return s === 'connected' || s === 'ok';
}

/**
 * Status em `evolution_instances.status` considerado conectado no Maturador / malha.
 * Case-insensitive; inclui variantes comuns da Evolution (open, ready, online).
 */
export function evolutionMaturationDbStatusIsConnected(dbStatus: unknown): boolean {
  const s = String(dbStatus ?? '').trim().toLowerCase();
  return (
    s === 'ok' ||
    s === 'open' ||
    s === 'connected' ||
    s === 'ready' ||
    s === 'online'
  );
}

/**
 * Só pausa maturação automaticamente quando o status indica sessão encerrada / offline explícito.
 * Evita pausar em estados transitórios (ex.: `connecting`), que não passam em
 * {@link evolutionMaturationDbStatusIsConnected} mas não são “close connection”.
 */
export function evolutionMaturationDbStatusShouldAutoPauseMaturation(dbStatus: unknown): boolean {
  const s = String(dbStatus ?? '').trim().toLowerCase();
  if (!s) return false;
  if (evolutionMaturationDbStatusIsConnected(dbStatus)) return false;
  const transitional = new Set([
    'connecting',
    'pairing',
    'qrcode',
    'qr',
    'waiting_qr',
    'waiting',
    'pairing_code',
    'loading',
    'starting',
    'unknown',
  ]);
  if (transitional.has(s)) return false;
  const explicit = new Set([
    'close',
    'closed',
    'disconnected',
    'offline',
    'logout',
    'destroyed',
    'forbidden',
    'unavailable',
    'error',
    'failed',
  ]);
  if (explicit.has(s)) return true;
  if (s.includes('close') || s.includes('disconnect')) return true;
  return false;
}
