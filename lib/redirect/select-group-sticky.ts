import { selectGroupByWeight } from '@/lib/vsl/redirect-weight';

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Seleção ponderada; com seed (ex.: sid) o grupo fica estável por sessão.
 */
export function selectGroupByWeightSticky<T extends { id: string; weight_percent: number }>(
  groups: T[],
  seed: string | null | undefined
): T | null {
  const valid = groups.filter((g) => g.weight_percent > 0);
  if (valid.length === 0) return null;

  if (!seed?.trim()) {
    return selectGroupByWeight(groups);
  }

  const total = valid.reduce((s, g) => s + g.weight_percent, 0);
  if (total <= 0) return null;

  const bucket = (hashSeed(seed.trim()) % 10000) / 10000;
  let r = bucket * total;
  for (const g of valid) {
    r -= g.weight_percent;
    if (r <= 0) return g;
  }
  return valid[valid.length - 1];
}

/** Grupos ativos: usa pesos > 0 ou fallback igualitário (peso 1). */
export function prepareWeightedGroups<
  T extends { id: string; name: string; invite_url: string; weight_percent: number },
>(groups: T[]): T[] {
  const weighted = groups.filter((g) => g.weight_percent > 0);
  if (weighted.length > 0) return weighted;
  return groups.map((g) => ({ ...g, weight_percent: 1 }));
}
