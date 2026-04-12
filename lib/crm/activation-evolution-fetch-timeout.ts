/**
 * Timeout do fetch do servidor Next → Evolution (sendMedia, sendText, sendPtv, etc.).
 * Vídeos e instâncias lentas costumam passar de 30s; o abort antecipado gerava falso timeout
 * antes do Netlify/proxy encerrar a requisição.
 *
 * Netlify: a rota precisa de `maxDuration` alto o bastante (ex.: 300s). Este valor só limita
 * o AbortController do fetch à Evolution — não aumenta o limite da função sozinho.
 *
 * @env ACTIVATION_EVOLUTION_FETCH_TIMEOUT_MS — milissegundos (ex.: 180000 = 3 min). Mínimo 10s, teto 270s.
 */
const FALLBACK_MS = 180_000;
const MIN_MS = 10_000;
const MAX_MS = 270_000;

export function getActivationEvolutionFetchTimeoutMs(): number {
  const raw = process.env.ACTIVATION_EVOLUTION_FETCH_TIMEOUT_MS;
  const parsed = raw != null && String(raw).trim() !== '' ? parseInt(String(raw).trim(), 10) : NaN;
  const base = Number.isFinite(parsed) && parsed >= MIN_MS ? parsed : FALLBACK_MS;
  return Math.min(MAX_MS, base);
}
