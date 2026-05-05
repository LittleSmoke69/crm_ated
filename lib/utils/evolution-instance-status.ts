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
