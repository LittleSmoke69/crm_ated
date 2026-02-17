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
