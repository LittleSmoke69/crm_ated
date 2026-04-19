/**
 * Divide 100 em n partes inteiras: parte base + resto distribuído +1% nos primeiros buckets (soma exata 100).
 */
export function splitHundredEqually(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Pesos finais: ativos recebem fatias iguais somando 100; inativos ficam com 0%.
 * Ordem dos ativos/inativos segue a ordem do array `rows` (ex.: ORDER BY name no SQL).
 */
export function equalWeightsForRedirectGroups<T extends { id: string; is_active: boolean }>(
  rows: T[]
): { id: string; weight_percent: number }[] {
  const active = rows.filter((r) => r.is_active);
  const inactive = rows.filter((r) => !r.is_active);
  const splits = splitHundredEqually(active.length);
  const out: { id: string; weight_percent: number }[] = [];
  active.forEach((r, i) => {
    out.push({ id: r.id, weight_percent: splits[i] ?? 0 });
  });
  inactive.forEach((r) => {
    out.push({ id: r.id, weight_percent: 0 });
  });
  return out;
}

/**
 * Seleção ponderada por weight_percent (soma 100). Apenas grupos ativos com weight > 0.
 */
export function selectGroupByWeight<T extends { weight_percent: number }>(
  groups: T[]
): T | null {
  const valid = groups.filter((g) => g.weight_percent > 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((s, g) => s + g.weight_percent, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const g of valid) {
    r -= g.weight_percent;
    if (r <= 0) return g;
  }
  return valid[valid.length - 1];
}
