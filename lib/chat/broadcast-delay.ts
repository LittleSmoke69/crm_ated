/**
 * Próximo intervalo (segundos) entre envios do disparo em massa.
 * Modo fixo: usa delay_seconds (limitado).
 * Modo aleatório: inteiro uniforme em [min, max] (inclusive), limites 1–7200 s.
 */
export function computeNextDelaySeconds(job: {
  delay_mode?: string | null;
  delay_seconds?: number | null;
  delay_min_seconds?: number | null;
  delay_max_seconds?: number | null;
}): number {
  if (String(job.delay_mode || '').toLowerCase() === 'random') {
    let lo = Math.max(1, Math.min(7200, Math.floor(Number(job.delay_min_seconds) || 1)));
    let hi = Math.max(1, Math.min(7200, Math.floor(Number(job.delay_max_seconds) || 120)));
    if (lo > hi) [lo, hi] = [hi, lo];
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }
  const s = Number(job.delay_seconds);
  return Math.min(7200, Math.max(10, Number.isFinite(s) ? Math.floor(s) : 120));
}
