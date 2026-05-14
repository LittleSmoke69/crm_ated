/**
 * Intervalo mínimo entre envios consecutivos no maturador manual e no auto-maturador (virgem).
 * Aplicado ao agendar steps (scheduled_at cumulativo).
 */

export const MATURATION_MIN_STEP_DELAY_SEC = 60;

export function clampMaturationStepDelaySec(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return MATURATION_MIN_STEP_DELAY_SEC;
  const i = Math.floor(n);
  return i < MATURATION_MIN_STEP_DELAY_SEC ? MATURATION_MIN_STEP_DELAY_SEC : i;
}
