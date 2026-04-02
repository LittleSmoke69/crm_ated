/**
 * Pausa entre disparos consecutivos na mesma campanha (activation_mass_send_jobs.inter_group_delay_ms).
 * 0 na coluna = usar padrão (env MASS_SEND_DEFAULT_INTER_GROUP_DELAY_MS ou 1000 ms).
 */

/** Limite superior da pausa entre grupos (UI: até 985 s). */
export const MAX_INTER_GROUP_DELAY_MS = 985_000;

function parseEnvMs(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, MAX_INTER_GROUP_DELAY_MS);
}

/** Padrão quando o usuário não personaliza (inter_group_delay_ms = 0). */
export function getDefaultInterGroupDelayMs(): number {
  return parseEnvMs('MASS_SEND_DEFAULT_INTER_GROUP_DELAY_MS', 1000);
}

/** Valor efetivo em ms para aguardar antes do envio ao grupo `processed_index` quando index > 0. */
export function resolveInterGroupDelayMs(stored: number | null | undefined): number {
  const raw = Number(stored);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), MAX_INTER_GROUP_DELAY_MS);
  }
  return getDefaultInterGroupDelayMs();
}

/** Normaliza valor vindo da API antes de gravar no job (0 = usar padrão no worker). */
export function clampStoredInterGroupDelayMs(ms: unknown): number {
  const n = typeof ms === 'number' ? ms : typeof ms === 'string' ? parseInt(ms, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_INTER_GROUP_DELAY_MS);
}

/**
 * Aceita `interGroupDelaySec` (0–985) ou `interGroupDelayMs` (0–985000). Segundos têm prioridade se ambos vierem.
 */
export function interGroupDelayMsFromRequestBody(body: Record<string, unknown>): number {
  const secRaw = body.interGroupDelaySec;
  if (secRaw !== undefined && secRaw !== null && secRaw !== '') {
    const sec = Number(secRaw);
    if (!Number.isFinite(sec) || sec <= 0) return 0;
    return clampStoredInterGroupDelayMs(Math.round(Math.min(sec, 985) * 1000));
  }
  const msRaw = body.interGroupDelayMs;
  if (msRaw !== undefined && msRaw !== null && msRaw !== '') {
    return clampStoredInterGroupDelayMs(Number(msRaw));
  }
  return 0;
}
