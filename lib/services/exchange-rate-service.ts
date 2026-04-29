/**
 * Exchange Rate Service
 *
 * Cotações de câmbio para conversão entre moedas usadas pelas Ad Accounts da Meta
 * (ex.: USD → BRL para painéis financeiros consolidados em reais).
 *
 * Estratégia:
 * - Provedor primário: AwesomeAPI (https://economia.awesomeapi.com.br) — gratuita, sem auth.
 * - Cache em memória por `CACHE_TTL_MS` para reduzir chamadas externas.
 * - Fallback configurável via `EXCHANGE_RATE_USD_BRL_FALLBACK` se a API falhar.
 * - Retorna sempre uma `ExchangeRateSnapshot` com `rate`, `source` e `fetched_at`.
 *
 * Importante:
 * - NUNCA logar tokens ou dados sensíveis. Esta API é pública.
 * - O serviço é idempotente; chamar em paralelo retorna a mesma promise enquanto o lookup estiver em curso.
 */

const META_LOG = '[Exchange Rate]';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_FALLBACK_RATE = 5.0;
const AWESOMEAPI_BASE = 'https://economia.awesomeapi.com.br/last';

/** Códigos de moeda suportados explicitamente. */
export type SupportedCurrencyPair = 'USD-BRL';

export type ExchangeRateSnapshot = {
  pair: SupportedCurrencyPair;
  rate: number;
  source: 'awesomeapi' | 'fallback' | 'cache';
  fetched_at: string;
  ttl_seconds: number;
  error?: string;
};

type CacheEntry = {
  snapshot: ExchangeRateSnapshot;
  expires_at: number;
};

const cache = new Map<SupportedCurrencyPair, CacheEntry>();
const inflight = new Map<SupportedCurrencyPair, Promise<ExchangeRateSnapshot>>();

function logRate(context: string, payload: Record<string, unknown>): void {
  console.log(META_LOG, context, payload);
}

function envFallbackRate(): number {
  const raw = process.env.EXCHANGE_RATE_USD_BRL_FALLBACK?.trim();
  if (!raw) return DEFAULT_FALLBACK_RATE;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FALLBACK_RATE;
}

async function fetchAwesomeApiRate(pair: SupportedCurrencyPair): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${AWESOMEAPI_BASE}/${encodeURIComponent(pair)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`AwesomeAPI HTTP ${res.status}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const key = pair.replace('-', '');
    const node = json?.[key] as { bid?: string; ask?: string; high?: string } | undefined;
    const bid = node?.bid ?? node?.ask ?? node?.high;
    const parsed = bid != null ? parseFloat(String(bid)) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('AwesomeAPI: cotação inválida.');
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRateFromProvider(pair: SupportedCurrencyPair): Promise<ExchangeRateSnapshot> {
  try {
    const rate = await fetchAwesomeApiRate(pair);
    const snapshot: ExchangeRateSnapshot = {
      pair,
      rate,
      source: 'awesomeapi',
      fetched_at: new Date().toISOString(),
      ttl_seconds: Math.round(CACHE_TTL_MS / 1000),
    };
    logRate('loadRateFromProvider', { pair, rate, source: snapshot.source });
    return snapshot;
  } catch (err: unknown) {
    const fallback = envFallbackRate();
    const msg = err instanceof Error ? err.message : String(err);
    logRate('loadRateFromProvider ← fallback', {
      pair,
      fallback_rate: fallback,
      error: msg,
    });
    return {
      pair,
      rate: fallback,
      source: 'fallback',
      fetched_at: new Date().toISOString(),
      ttl_seconds: 60,
      error: msg,
    };
  }
}

/**
 * Retorna a cotação atual para o par solicitado, usando cache em memória.
 *
 * - Cache hit válido (não expirado): devolve com `source: 'cache'`.
 * - Cache miss: busca no provedor (AwesomeAPI). Em caso de erro, retorna fallback configurável.
 * - Coalescência de chamadas: requisições simultâneas para o mesmo par compartilham a mesma promise.
 */
export async function getExchangeRate(pair: SupportedCurrencyPair): Promise<ExchangeRateSnapshot> {
  const now = Date.now();
  const cached = cache.get(pair);
  if (cached && cached.expires_at > now) {
    return { ...cached.snapshot, source: 'cache' };
  }

  const existing = inflight.get(pair);
  if (existing) return existing;

  const promise = (async () => {
    const snapshot = await loadRateFromProvider(pair);
    const ttl = snapshot.source === 'fallback' ? 60_000 : CACHE_TTL_MS;
    cache.set(pair, { snapshot, expires_at: Date.now() + ttl });
    return snapshot;
  })().finally(() => {
    inflight.delete(pair);
  });

  inflight.set(pair, promise);
  return promise;
}

/** Atalho usado pelo painel Meta: cotação atual de USD em BRL. */
export async function getUsdToBrlRate(): Promise<ExchangeRateSnapshot> {
  return getExchangeRate('USD-BRL');
}

/**
 * Converte um valor monetário em uma moeda Meta para BRL usando o `rates` informado.
 * Se a moeda já é BRL ou nula, retorna o valor original.
 * Se não houver cotação disponível para a moeda, retorna `null` (chamador decide o fallback).
 */
export function convertMetaSpendToBrl(
  spend: number | null | undefined,
  currency: string | null | undefined,
  rates: Partial<Record<string, number>>
): number | null {
  if (spend == null || !Number.isFinite(spend)) return null;
  const code = String(currency ?? '').trim().toUpperCase();
  if (!code || code === 'BRL') return spend;
  const rate = rates[code];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return spend * rate;
}

/**
 * Resolve um pacote mínimo de cotações com base nas moedas usadas pelas contas da Meta.
 * Atualmente só converte USD; outras moedas usam taxa 1 (NÃO convertem) e ficam visíveis no log.
 */
export async function resolveExchangeRatesForCurrencies(currencies: Iterable<string>): Promise<{
  rates: Record<string, number>;
  snapshots: ExchangeRateSnapshot[];
}> {
  const codes = new Set<string>();
  for (const c of currencies) {
    const code = String(c ?? '').trim().toUpperCase();
    if (code) codes.add(code);
  }
  codes.add('BRL');
  const rates: Record<string, number> = { BRL: 1 };
  const snapshots: ExchangeRateSnapshot[] = [];
  if (codes.has('USD')) {
    const snap = await getUsdToBrlRate();
    rates.USD = snap.rate;
    snapshots.push(snap);
  }
  for (const code of codes) {
    if (rates[code] == null) {
      logRate('resolveExchangeRatesForCurrencies ← moeda sem cota\u00e7\u00e3o configurada', {
        currency: code,
        observation: 'Valores nessa moeda n\u00e3o ser\u00e3o convertidos automaticamente; usaremos 1 como taxa neutra.',
      });
      rates[code] = 1;
    }
  }
  return { rates, snapshots };
}
