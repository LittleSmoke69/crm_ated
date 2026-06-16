/**
 * Monta headers X-Effective-* a partir do valor do seletor (banca:uuid ou dono:uuid).
 */
export function buildGestorEffectiveHeaders(selectedId: string): Record<string, string> {
  const v = selectedId?.trim();
  if (!v) return {};
  if (v.startsWith('banca:')) {
    return { 'X-Effective-Banca-Id': v.slice(6).trim() };
  }
  if (v.startsWith('dono:')) {
    return { 'X-Effective-Dono-Id': v.slice(5).trim() };
  }
  return { 'X-Effective-Dono-Id': v };
}
