/**
 * Próximo intervalo (segundos) entre envios do disparo em massa.
 * Modo fixo: usa delay_seconds (limitado).
 * Modo aleatório: inteiro uniforme em [min, max] (inclusive), limites 1–7200 s.
 */
/** Padrão do chat de atendimento: intervalo aleatório entre contatos (segundos). */
export const BROADCAST_DEFAULT_RANDOM_MIN_SEC = 120;
export const BROADCAST_DEFAULT_RANDOM_MAX_SEC = 240;

export function computeNextDelaySeconds(job: {
  delay_mode?: string | null;
  delay_seconds?: number | null;
  delay_min_seconds?: number | null;
  delay_max_seconds?: number | null;
}): number {
  if (String(job.delay_mode || '').toLowerCase() === 'random') {
    let lo = Math.max(
      1,
      Math.min(7200, Math.floor(Number(job.delay_min_seconds) || BROADCAST_DEFAULT_RANDOM_MIN_SEC))
    );
    let hi = Math.max(
      1,
      Math.min(7200, Math.floor(Number(job.delay_max_seconds) || BROADCAST_DEFAULT_RANDOM_MAX_SEC))
    );
    if (lo > hi) [lo, hi] = [hi, lo];
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }
  const s = Number(job.delay_seconds);
  return Math.min(7200, Math.max(10, Number.isFinite(s) ? Math.floor(s) : 120));
}
