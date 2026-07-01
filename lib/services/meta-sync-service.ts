/**
 * Meta Ads Sync Service
 * Sincroniza campanhas, adsets e insights da Meta Graph API para o Supabase.
 * Usa token descriptografado apenas em memória; nunca em logs.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { encryptionService } from '@/lib/services/encryption-service';
import {
  getMe,
  getAdAccounts,
  listCampaigns,
  listAdSets,
  getInsightsDaily,
  getAccountFinance,
  getAdAccountBillingCharges,
  mapInsightToRow,
  normalizeBudget,
  formatMetaDate,
  type InsightsDateOption,
  type MetaAccountFinance,
  type MetaInsight,
} from '@/lib/meta/metaClient';
import {
  getActiveCampaignsSpend,
  type GetActiveCampaignsSpendOptions,
  type ActiveCampaignSpendRow,
} from '@/lib/meta/metaAdsService';
import { buildCampaignConsultorSummary } from '@/lib/services/meta-campaign-consultors';
import type { CrmBancaLite } from '@/lib/services/gestor-names-by-crm-banca';
import {
  resolvePrimaryGestorDisplayByCrmBancaIds,
  type GestorDisplayForCampaign,
} from '@/lib/services/meta-campaign-gestor-display';
import {
  convertMetaSpendToBrl,
  resolveExchangeRatesForCurrencies,
  type ExchangeRateSnapshot,
} from '@/lib/services/exchange-rate-service';
import { isMetaVerboseLogEnabled, metaVerboseLog } from '@/lib/utils/meta-debug-log';

export const DEFAULT_BASE_URL = 'https://graph.facebook.com/v25.0';
const DEFAULT_DATE_PRESET = 'last_30d';

/**
 * Concorrência de jobs Meta nas agregações admin (live-aggregate, stream e consolidado).
 * Default 6: equilíbrio entre velocidade (~6× vs. série) e risco de rate limit da Graph API
 * (códigos 4/17/32/613/80000+ disparam backoff no metaClient). Ajustável via env.
 */
const META_AGG_CONCURRENCY = (() => {
  const raw = parseInt(String(process.env.META_AGG_CONCURRENCY ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 32) return raw;
  return 6;
})();

/**
 * Executa `worker` sobre `items` com no máximo `concurrency` tarefas em voo.
 * Preserva a ordem do array de saída (índice i ↔ items[i]); nunca rejeita — o tipo
 * de retorno do worker deve carregar erros (ex.: Promise.allSettled / trace de erro).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners: Promise<void>[] = [];
  for (let k = 0; k < limit; k++) runners.push(run());
  await Promise.all(runners);
  return results;
}

/**
 * Itera `items` com pool de `concurrency` e entrega cada resultado assim que fica pronto
 * (ordem de conclusão, não de entrada). Usado pelo stream para emitir batches conforme
 * cada job Meta termina, sem esperar a fila inteira. `worker` não deve rejeitar.
 */
async function* streamWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): AsyncGenerator<R> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;
  const inFlight = new Map<number, Promise<{ key: number; value: R }>>();
  const launch = () => {
    const i = cursor++;
    const key = i;
    inFlight.set(
      key,
      worker(items[i], i).then((value) => ({ key, value }))
    );
  };
  for (let k = 0; k < limit && cursor < items.length; k++) launch();
  while (inFlight.size > 0) {
    const { key, value } = await Promise.race(inFlight.values());
    inFlight.delete(key);
    if (cursor < items.length) launch();
    yield value;
  }
}

/** Logs do retorno bruto da Meta (admin / sync); nunca incluir token. */
const META_API_LOG = '[Meta Ads API]';

const ZERO_DECIMAL_META_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/**
 * Cobrança individual da conta (event_type=ad_account_billing_charge),
 * já normalizada para unidade principal da moeda (ex.: BRL).
 */
export type MetaBillingChargeRow = {
  event_time: string | null;
  date_time_in_timezone: string | null;
  amount: number | null;
  amount_raw: string | null;
  currency: string | null;
  transaction_id: string | null;
};

export type MetaBillingChargesSnapshot = {
  source: 'ad_account_activities';
  /** Filtro do painel (since/until em YYYY-MM-DD) — pode ser null quando o cliente quer só o histórico. */
  period_filter: { since: string | null; until: string | null };
  /**
   * Janela efetivamente consultada na Meta (geralmente >= filtro), para garantir contexto
   * (ex.: histórico de 90 dias) quando o filtro do painel é estreito (ex.: "ontem").
   */
  period_window: { since: string | null; until: string | null };
  /** Número de cobranças dentro de `period_filter` (ou da janela inteira quando não há filtro). */
  count: number;
  /** Soma das cobranças dentro de `period_filter` (ou da janela inteira). */
  total: number;
  /** Total de cobranças retornadas na janela `period_window` (`>= count`). */
  count_window: number;
  /** Soma das cobranças na janela `period_window` (`>= total`). */
  total_window: number;
  currency: string | null;
  /** Cobrança mais recente da janela `period_window` — útil como "última cobrança" quando o filtro não tem nada. */
  latest_charge: MetaBillingChargeRow | null;
  fetched_at: string;
  error?: string;
  /** Lista detalhada (limitada por paginação) — apenas as entradas dentro de `period_filter` quando há filtro. */
  entries: MetaBillingChargeRow[];
};

export type MetaBillingSnapshot = {
  ad_account_id: string;
  currency: string | null;
  timezone_name: string | null;
  /** Total acumulado da conta retornado por `amount_spent`, normalizado para unidade principal da moeda. */
  amount_spent: number | null;
  amount_spent_raw: string | null;
  /** Valor em aberto/faturável da conta retornado por `balance`, normalizado para unidade principal da moeda. */
  balance_due: number | null;
  balance_due_raw: string | null;
  /** Limite de gasto da conta retornado por `spend_cap`, normalizado para unidade principal da moeda. */
  spend_cap: number | null;
  spend_cap_raw: string | null;
  source: 'ad_account_finance';
  fetched_at: string;
  error?: string;
  /**
   * Cobranças reais no método de pagamento (cartão), via `/activities` com
   * `event_type=ad_account_billing_charge`. Normalizadas na unidade principal da moeda.
   * Pode ser null se a Meta não tiver retornado dados para a conta no período.
   */
  card_charges?: MetaBillingChargesSnapshot | null;
};

export type MetaBillingSummary = {
  source: 'ad_account_finance';
  /** Valores monetários normalizados para unidade principal da moeda (ex.: BRL), quando a moeda tem centavos. */
  unit: 'major_currency_units';
  accounts_count: number;
  accounts_with_balance_due: number;
  accounts_with_amount_spent: number;
  currencies: string[];
  currency: string | null;
  total_balance_due: number;
  total_amount_spent: number;
  total_spend_cap: number;
  /**
   * Soma das cobranças efetivas no cartão (todas as contas) no período do filtro,
   * **sempre em BRL** — valores em USD (e outras moedas com cotação) convertidos.
   */
  total_card_charges: number;
  /**
   * Parcela da soma acima que veio de contas em USD, **ainda em dólar** (antes da conversão).
   * Só para exibição no painel (ex.: “US$ X · ≈ R$ Y”). Zero quando não há cobrança USD.
   */
  total_card_charges_usd: number;
  /** Quantidade total de cobranças no período do filtro. */
  card_charges_count: number;
  /**
   * Soma na janela ampla (~90d), **em BRL** (USD convertido).
   */
  total_card_charges_window: number;
  /** Parcela em USD na janela ampla (antes de converter). */
  total_card_charges_window_usd: number;
  /** Quantidade total de cobranças na janela ampla. */
  card_charges_count_window: number;
  /** Quantas contas tinham `card_charges` retornado pela Meta sem erro. */
  accounts_with_card_charges: number;
  /** Período aplicado nas chamadas (YYYY-MM-DD), espelhando o filtro do painel. */
  card_charges_period: { since: string | null; until: string | null } | null;
  /** Janela ampla consultada na Meta (~90d). */
  card_charges_window: { since: string | null; until: string | null } | null;
  /** Cobrança mais recente entre todas as contas (útil quando o filtro do painel não tem cobrança). */
  latest_card_charge:
    | {
        ad_account_id: string;
        amount: number | null;
        /** Mesmo `amount` convertido para BRL quando a cobrança não é em real. */
        amount_brl: number | null;
        event_time: string | null;
        currency: string | null;
        transaction_id: string | null;
      }
    | null;
  accounts: MetaBillingSnapshot[];
};

function logMetaReturn(context: string, data: Record<string, unknown>): void {
  if (!isMetaVerboseLogEnabled()) return;
  console.log(META_API_LOG, context, data);
}

function normalizeMetaAdAccountId(adAccountId: string): string {
  const t = String(adAccountId ?? '').trim();
  if (!t) return '';
  return t.startsWith('act_') ? t : `act_${t}`;
}

function metaCurrencyMinorUnitDivisor(currency: string | null | undefined): number {
  const code = String(currency ?? '').trim().toUpperCase();
  return code && ZERO_DECIMAL_META_CURRENCIES.has(code) ? 1 : 100;
}

function normalizeMetaFinanceAmount(raw: string | number | null | undefined, currency: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  return n / metaCurrencyMinorUnitDivisor(currency);
}

export function buildMetaBillingSnapshot(
  adAccountId: string,
  finance: MetaAccountFinance | null,
  error?: string,
  cardCharges?: MetaBillingChargesSnapshot | null
): MetaBillingSnapshot {
  const currency = finance?.currency != null ? String(finance.currency) : null;
  const amountSpentRaw = finance?.amount_spent != null ? String(finance.amount_spent) : null;
  const balanceRaw = finance?.balance != null ? String(finance.balance) : null;
  const spendCapRaw = finance?.spend_cap != null ? String(finance.spend_cap) : null;
  return {
    ad_account_id: normalizeMetaAdAccountId(adAccountId),
    currency,
    timezone_name: finance?.timezone_name != null ? String(finance.timezone_name) : null,
    amount_spent: normalizeMetaFinanceAmount(amountSpentRaw, currency),
    amount_spent_raw: amountSpentRaw,
    balance_due: normalizeMetaFinanceAmount(balanceRaw, currency),
    balance_due_raw: balanceRaw,
    spend_cap: normalizeMetaFinanceAmount(spendCapRaw, currency),
    spend_cap_raw: spendCapRaw,
    source: 'ad_account_finance',
    fetched_at: new Date().toISOString(),
    ...(error ? { error } : {}),
    card_charges: cardCharges ?? null,
  };
}

export type FetchMetaBillingSnapshotOptions = {
  /** Período aplicado às cobranças no cartão (`activities` → `ad_account_billing_charge`). YYYY-MM-DD. */
  cardChargesPeriod?: { since: string | null; until: string | null } | null;
  /** Limite por página da API `/activities`. Default 200, máx 500. */
  cardChargesPageLimit?: number;
  /** Máximo de páginas a paginar. Default 5. */
  cardChargesMaxPages?: number;
  /**
   * Moeda guardada no CRM (`meta_integration_configs.currency` / `meta_integrations.currency`) quando
   * a Meta não devolve `currency` em `adaccount` (finance) a tempo. Evita tratar USD como BRL no
   * `normalizeMetaFinanceAmount` e zera o total de cobranças.
   */
  integrationCurrencyHint?: string | null;
  /**
   * Quando true, NÃO consulta `/activities` (cobranças no cartão) — a parte lenta do snapshot.
   * Ainda busca `getAccountFinance` (moeda/saldo), que é barato e necessário para conversão BRL.
   * Usado por chamadores que só precisam de finance/moeda (ex.: daily_spend do card).
   */
  skipCardCharges?: boolean;
};

/** Subtrai `days` dias de um Date (UTC), retornando YYYY-MM-DD. */
function ymdDaysAgoUtc(days: number): string {
  const t = Date.now() - days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** YYYY-MM-DD de hoje em UTC. */
function ymdTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const CARD_CHARGES_MIN_LOOKBACK_DAYS = 90;

/**
 * Resolve a janela a ser consultada na Meta para `card_charges`.
 *
 * Sempre garante pelo menos `CARD_CHARGES_MIN_LOOKBACK_DAYS` de histórico,
 * mesmo que o filtro do painel seja só "ontem". Isso evita que filtros estreitos
 * resultem em "0 cobranças" quando há, sim, cobranças recentes (que costumam
 * acontecer a cada poucos dias quando atinge o threshold do cartão).
 */
function resolveCardChargesWindow(
  filter: { since: string | null; until: string | null }
): { since: string; until: string } {
  const today = ymdTodayUtc();
  const minSince = ymdDaysAgoUtc(CARD_CHARGES_MIN_LOOKBACK_DAYS);
  const since = filter.since && filter.since < minSince ? filter.since : minSince;
  const until = filter.until && filter.until > today ? filter.until : today;
  return { since, until };
}

/**
 * Meta `/activities` pode devolver `event_time` como ISO ou como Unix em segundos (string numérica).
 */
function parseMetaActivityEventTimeMs(eventTime: string | null): number | null {
  if (eventTime == null || String(eventTime).trim() === '') return null;
  const t = String(eventTime).trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return t.length <= 10 ? n * 1000 : n;
  }
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWithinPeriod(
  eventTime: string | null,
  filter: { since: string | null; until: string | null }
): boolean {
  if (!filter.since && !filter.until) return true;
  if (!eventTime) return false;
  const ts = parseMetaActivityEventTimeMs(eventTime);
  if (ts == null || !Number.isFinite(ts)) return false;
  if (filter.since) {
    const sinceTs = Date.UTC(
      Number(filter.since.slice(0, 4)),
      Number(filter.since.slice(5, 7)) - 1,
      Number(filter.since.slice(8, 10))
    );
    if (Number.isFinite(sinceTs) && ts < sinceTs) return false;
  }
  if (filter.until) {
    const untilTs =
      Date.UTC(
        Number(filter.until.slice(0, 4)),
        Number(filter.until.slice(5, 7)) - 1,
        Number(filter.until.slice(8, 10))
      ) +
      86399_999;
    if (Number.isFinite(untilTs) && ts > untilTs) return false;
  }
  return true;
}

async function fetchMetaCardChargesSnapshot(
  baseUrl: string,
  token: string,
  adAccountId: string,
  filter: { since: string | null; until: string | null },
  fallbackCurrency: string | null,
  pageOptions?: { limit?: number; maxPages?: number }
): Promise<MetaBillingChargesSnapshot> {
  const window = resolveCardChargesWindow(filter);
  try {
    const charges = await getAdAccountBillingCharges(
      baseUrl,
      token,
      adAccountId,
      window.since,
      window.until,
      pageOptions
    );
    const currencyFromEntries = charges
      .map((c) => c.currency)
      .find((c): c is string => Boolean(c && c.trim())) ?? null;
    const resolvedCurrency = currencyFromEntries ?? fallbackCurrency;

    const allEntries: MetaBillingChargeRow[] = charges.map((c) => {
      const normalizedAmount = normalizeMetaFinanceAmount(c.amount_raw, c.currency ?? resolvedCurrency);
      return {
        event_time: c.event_time,
        date_time_in_timezone: c.date_time_in_timezone,
        amount: normalizedAmount,
        amount_raw: c.amount_raw,
        currency: c.currency ?? resolvedCurrency,
        transaction_id: c.transaction_id,
      };
    });

    const hasFilter = Boolean(filter.since || filter.until);
    const inPeriod = hasFilter
      ? allEntries.filter((e) => isWithinPeriod(e.event_time, filter))
      : allEntries;

    const totalInPeriod = inPeriod.reduce((s, e) => s + (e.amount ?? 0), 0);
    const totalWindow = allEntries.reduce((s, e) => s + (e.amount ?? 0), 0);
    const latestCharge = allEntries.reduce<MetaBillingChargeRow | null>((latest, entry) => {
      if (!entry.event_time) return latest;
      const ts = parseMetaActivityEventTimeMs(entry.event_time);
      if (ts == null || !Number.isFinite(ts)) return latest;
      const latestTs = latest?.event_time ? parseMetaActivityEventTimeMs(latest.event_time) ?? -Infinity : -Infinity;
      return ts > latestTs ? entry : latest;
    }, null);

    return {
      source: 'ad_account_activities',
      period_filter: { since: filter.since ?? null, until: filter.until ?? null },
      period_window: { since: window.since, until: window.until },
      count: inPeriod.length,
      total: totalInPeriod,
      count_window: allEntries.length,
      total_window: totalWindow,
      currency: resolvedCurrency,
      latest_charge: latestCharge,
      fetched_at: new Date().toISOString(),
      entries: inPeriod,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source: 'ad_account_activities',
      period_filter: { since: filter.since ?? null, until: filter.until ?? null },
      period_window: { since: window.since, until: window.until },
      count: 0,
      total: 0,
      count_window: 0,
      total_window: 0,
      currency: fallbackCurrency,
      latest_charge: null,
      fetched_at: new Date().toISOString(),
      error: msg,
      entries: [],
    };
  }
}

export async function fetchMetaBillingSnapshot(
  baseUrl: string,
  token: string,
  adAccountId: string,
  options?: FetchMetaBillingSnapshotOptions
): Promise<MetaBillingSnapshot> {
  let financeData: MetaAccountFinance | null = null;
  let financeError: string | undefined;
  try {
    financeData = await getAccountFinance(baseUrl, token, adAccountId);
  } catch (err: unknown) {
    financeError = err instanceof Error ? err.message : String(err);
  }
  const hint = options?.integrationCurrencyHint != null ? String(options.integrationCurrencyHint).trim() : '';
  const fallbackCurrency =
    financeData?.currency != null
      ? String(financeData.currency)
      : hint !== ''
        ? hint
        : null;
  const period = options?.cardChargesPeriod
    ? { since: options.cardChargesPeriod.since ?? null, until: options.cardChargesPeriod.until ?? null }
    : { since: null, until: null };
  const cardCharges: MetaBillingChargesSnapshot = options?.skipCardCharges
    ? {
        source: 'ad_account_activities',
        period_filter: { since: period.since, until: period.until },
        period_window: { since: null, until: null },
        count: 0,
        total: 0,
        count_window: 0,
        total_window: 0,
        currency: fallbackCurrency,
        latest_charge: null,
        fetched_at: new Date().toISOString(),
        entries: [],
      }
    : await fetchMetaCardChargesSnapshot(
        baseUrl,
        token,
        adAccountId,
        period,
        fallbackCurrency,
        {
          limit: options?.cardChargesPageLimit,
          maxPages: options?.cardChargesMaxPages,
        }
      );
  return buildMetaBillingSnapshot(adAccountId, financeData, financeError, cardCharges);
}

export type SummarizeMetaBillingSnapshotsOptions = {
  /** Taxas para converter cobranças no cartão para BRL (ex.: `{ BRL: 1, USD: 5.4 }`). */
  exchangeRatesToBrl?: Record<string, number>;
};

export function summarizeMetaBillingSnapshots(
  snapshots: MetaBillingSnapshot[],
  options?: SummarizeMetaBillingSnapshotsOptions
): MetaBillingSummary {
  const rates: Record<string, number> = { BRL: 1, ...(options?.exchangeRatesToBrl ?? {}) };

  const byAccount = new Map<string, MetaBillingSnapshot>();
  for (const snap of snapshots) {
    const key = normalizeMetaAdAccountId(snap.ad_account_id);
    if (!key) continue;
    const prev = byAccount.get(key);
    if (!prev || (prev.error && !snap.error)) byAccount.set(key, { ...snap, ad_account_id: key });
  }
  const accounts = [...byAccount.values()];
  const currencies = Array.from(
    new Set(accounts.map((a) => a.currency).filter((c): c is string => Boolean(c)))
  ).sort();
  const accountsWithCardCharges = accounts.filter((a) => a.card_charges && !a.card_charges.error);

  let totalCardChargesBrl = 0;
  let totalCardChargesUsdRaw = 0;
  let cardChargesCount = 0;
  let totalCardChargesWindowBrl = 0;
  let totalCardChargesWindowUsdRaw = 0;
  let cardChargesCountWindow = 0;

  for (const a of accountsWithCardCharges) {
    const cc = a.card_charges;
    if (!cc) continue;
    const chargeCurrency =
      String(cc.currency ?? a.currency ?? '')
        .trim()
        .toUpperCase() || 'BRL';

    const periodTotal = cc.total ?? 0;
    const periodBrl =
      convertMetaSpendToBrl(periodTotal, chargeCurrency, rates) ??
      (chargeCurrency === 'BRL' || chargeCurrency === '' ? periodTotal : periodTotal);
    totalCardChargesBrl += periodBrl;
    if (chargeCurrency === 'USD') {
      totalCardChargesUsdRaw += periodTotal;
    }

    cardChargesCount += cc.count ?? 0;

    const windowTotal = cc.total_window ?? 0;
    const windowBrl =
      convertMetaSpendToBrl(windowTotal, chargeCurrency, rates) ??
      (chargeCurrency === 'BRL' || chargeCurrency === '' ? windowTotal : windowTotal);
    totalCardChargesWindowBrl += windowBrl;
    if (chargeCurrency === 'USD') {
      totalCardChargesWindowUsdRaw += windowTotal;
    }

    cardChargesCountWindow += cc.count_window ?? 0;
  }

  let cardChargesPeriod: { since: string | null; until: string | null } | null = null;
  let cardChargesWindow: { since: string | null; until: string | null } | null = null;
  for (const a of accounts) {
    const cc = a.card_charges;
    if (!cc) continue;
    if (!cardChargesPeriod && cc.period_filter) {
      cardChargesPeriod = {
        since: cc.period_filter.since ?? null,
        until: cc.period_filter.until ?? null,
      };
    }
    if (!cardChargesWindow && cc.period_window) {
      cardChargesWindow = {
        since: cc.period_window.since ?? null,
        until: cc.period_window.until ?? null,
      };
    }
    if (cardChargesPeriod && cardChargesWindow) break;
  }

  let latestCardCharge: MetaBillingSummary['latest_card_charge'] = null;
  for (const a of accounts) {
    const lc = a.card_charges?.latest_charge ?? null;
    if (!lc?.event_time) continue;
    const ts = parseMetaActivityEventTimeMs(lc.event_time);
    if (ts == null || !Number.isFinite(ts)) continue;
    const currentTs = latestCardCharge?.event_time
      ? parseMetaActivityEventTimeMs(latestCardCharge.event_time) ?? -Infinity
      : -Infinity;
    if (ts > currentTs) {
      const latestCur =
        String(lc.currency ?? a.currency ?? '')
          .trim()
          .toUpperCase() || 'BRL';
      const amt = lc.amount;
      const amtBrl =
        amt != null && Number.isFinite(amt)
          ? convertMetaSpendToBrl(amt, latestCur, rates) ??
            (latestCur === 'BRL' || latestCur === '' ? amt : amt)
          : null;
      latestCardCharge = {
        ad_account_id: a.ad_account_id,
        amount: lc.amount,
        amount_brl: amtBrl,
        event_time: lc.event_time,
        currency: lc.currency,
        transaction_id: lc.transaction_id,
      };
    }
  }

  return {
    source: 'ad_account_finance',
    unit: 'major_currency_units',
    accounts_count: accounts.length,
    accounts_with_balance_due: accounts.filter((a) => a.balance_due != null).length,
    accounts_with_amount_spent: accounts.filter((a) => a.amount_spent != null).length,
    currencies,
    currency: currencies.length === 1 ? currencies[0] : null,
    total_balance_due: accounts.reduce((s, a) => s + (a.balance_due ?? 0), 0),
    total_amount_spent: accounts.reduce((s, a) => s + (a.amount_spent ?? 0), 0),
    total_spend_cap: accounts.reduce((s, a) => s + (a.spend_cap ?? 0), 0),
    total_card_charges: totalCardChargesBrl,
    total_card_charges_usd: totalCardChargesUsdRaw,
    card_charges_count: cardChargesCount,
    total_card_charges_window: totalCardChargesWindowBrl,
    total_card_charges_window_usd: totalCardChargesWindowUsdRaw,
    card_charges_count_window: cardChargesCountWindow,
    accounts_with_card_charges: accountsWithCardCharges.length,
    card_charges_period: cardChargesPeriod,
    card_charges_window: cardChargesWindow,
    latest_card_charge: latestCardCharge,
    accounts,
  };
}

/**
 * IDs explícitos no cadastro (vírgula = várias contas). Normaliza com prefixo act_.
 * Quando não vazio, a sincronização deve usar só estes IDs — não misturar com outras contas do token
 * (senão a 2ª integração na mesma banca caía na primeira conta retornada pelo token).
 */
function parseConfiguredAdAccountIds(
  raw: string | null | undefined,
  /** act_ ids bloqueados a excluir (vírgula). Não usados no sync/spend. */
  blockedRaw?: string | null
): string[] {
  if (raw == null || String(raw).trim() === '') return [];
  const normalize = (p: string) => (p.startsWith('act_') ? p : `act_${p}`);
  const blocked = new Set(
    String(blockedRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalize)
  );
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const id = normalize(p);
    if (blocked.has(id)) continue; // conta bloqueada → ignorada
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Retorna time_range desde (hoje - dias) até hoje em YYYY-MM-DD. Meta usa timezone da conta. */
function getTimeRangeSinceUntil(daysAgo: number): { since: string; until: string } {
  const now = new Date();
  const until = formatMetaDate(now);
  const since = new Date(now);
  since.setDate(since.getDate() - daysAgo);
  return { since: formatMetaDate(since), until };
}

/** Mantém só linhas diárias cuja `date_start` cai no intervalo inclusivo (YYYY-MM-DD). */
function filterInsightsByDateStartRange(
  insights: MetaInsight[],
  dateFrom: string,
  dateTo: string
): MetaInsight[] {
  if (!dateFrom || !dateTo || dateFrom > dateTo) return insights;
  return insights.filter((ins) => {
    const ds = ins.date_start || '';
    return ds >= dateFrom && ds <= dateTo;
  });
}

/** Soma dias a uma data YYYY-MM-DD (calendário). */
function addCalendarDays(isoDate: string, deltaDays: number): string {
  const parts = String(isoDate).trim().split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return isoDate;
  const [y, m, d] = parts;
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Insights em nível de campanha: `date_preset` (ex. last_30d) usa o fuso da conta na Meta.
 * O time_range montado em UTC no servidor costuma devolver 0 linhas mesmo com campanhas ativas.
 * Quando `preferTimeRangeFirst` (ex.: período explícito na UI), tenta o intervalo antes do preset.
 *
 * `strictInsightRange`: painel admin com datas da UI — só devolve linhas cuja `date_start` cai no intervalo.
 * Usa time_range ampliado (±dias) para contornar fuso da conta na Meta e **não** usa last_90d (que misturaria períodos).
 */
async function fetchCampaignInsightsWithFallbacks(
  baseUrl: string,
  token: string,
  adAccountId: string,
  datePreset: string,
  timeRangeUtc: { since: string; until: string },
  options?: {
    preferTimeRangeFirst?: boolean;
    strictInsightRange?: { from: string; to: string };
  }
): Promise<{ insights: MetaInsight[]; sourceLabel: string }> {
  const preset = (datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  const strict = options?.strictInsightRange;
  if (strict && strict.from && strict.to && strict.from <= strict.to) {
    const padDays = [0, 1, 3, 7, 14];
    for (const pad of padDays) {
      const since = addCalendarDays(strict.from, -pad);
      const until = addCalendarDays(strict.to, pad);
      const rows = await getInsightsDaily(baseUrl, token, adAccountId, { since, until });
      const filtered = filterInsightsByDateStartRange(rows, strict.from, strict.to);
      if (filtered.length > 0) {
        logMetaReturn('fetchCampaignInsightsWithFallbacks ← usado (strict range + padding)', {
          ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
          ui_range: `${strict.from}..${strict.to}`,
          request_range: `${since}..${until}`,
          padding_days: pad,
          rows_raw: rows.length,
          rows_filtered: filtered.length,
        });
        return {
          insights: filtered,
          sourceLabel: `${strict.from}..${strict.to} (Meta time_range ±${pad}d, filtrado por dia)`,
        };
      }
    }
    logMetaReturn('fetchCampaignInsightsWithFallbacks ← strict range sem linhas após padding', {
      ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
      ui_range: `${strict.from}..${strict.to}`,
    });
    return {
      insights: [],
      sourceLabel: `${strict.from}..${strict.to} (sem insights no Graph neste intervalo)`,
    };
  }

  const rangeOpt: InsightsDateOption = timeRangeUtc;
  const rangeLabelUi = `${timeRangeUtc.since}..${timeRangeUtc.until} (time_range)`;
  const rangeLabelFallback = `${timeRangeUtc.since}..${timeRangeUtc.until} (time_range, servidor UTC)`;

  const attempts: Array<{ label: string; opt: InsightsDateOption }> = options?.preferTimeRangeFirst
    ? [
        { label: rangeLabelUi, opt: rangeOpt },
        { label: preset, opt: preset },
        { label: 'last_90d', opt: 'last_90d' },
        { label: 'last_year', opt: 'last_year' },
        { label: 'maximum', opt: 'maximum' },
      ]
    : [
        { label: preset, opt: preset },
        { label: rangeLabelFallback, opt: rangeOpt },
        { label: 'last_90d', opt: 'last_90d' },
        { label: 'last_year', opt: 'last_year' },
        { label: 'maximum', opt: 'maximum' },
      ];

  for (const { label, opt } of attempts) {
    const rows = await getInsightsDaily(baseUrl, token, adAccountId, opt);
    if (rows.length > 0) {
      logMetaReturn('fetchCampaignInsightsWithFallbacks ← usado', {
        ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
        source: label,
        rows: rows.length,
      });
      return { insights: rows, sourceLabel: label };
    }
  }

  logMetaReturn('fetchCampaignInsightsWithFallbacks ← vazio após tentativas', {
    ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
    tried: attempts.map((a) => a.label),
  });
  return { insights: [], sourceLabel: `${preset} (0 linhas após fallbacks)` };
}

export interface MetaConfigInput {
  base_url?: string;
  access_token?: string;
  ad_account_id?: string;
  /** Contas de anúncio bloqueadas (act_ ids, vírgula) — ignoradas no sync/spend. */
  blocked_ad_account_ids?: string;
  pixel_id?: string;
  default_campaign_id?: string;
  is_active?: boolean;
}

export interface MetaIntegrationRow {
  /** integration_id (novo modelo compartilhado) */
  id: string;
  /** banca_id selecionada no contexto (para compat/UI) */
  banca_id: string;
  base_url: string;
  access_token_encrypted: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  blocked_ad_account_ids: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  currency: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  banca_ids?: string[];
}

/** Todas as integrações Meta vinculadas à banca (ordem de criação do vínculo). */
export async function listIntegrationIdsByBanca(bancaId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id, created_at')
    .eq('banca_id', bancaId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return [];
  return data.map((r: { integration_id: string }) => String(r.integration_id));
}

async function resolveIntegrationIdByBanca(bancaId: string): Promise<string | null> {
  const ids = await listIntegrationIdsByBanca(bancaId);
  return ids[0] ?? null;
}

export async function listBancasByIntegration(integrationId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('banca_id')
    .eq('integration_id', integrationId);
  if (error || !data) return [];
  return data.map((r: any) => String(r.banca_id));
}

export async function isMetaIntegrationLinkedToBanca(integrationId: string, bancaId: string): Promise<boolean> {
  const { data } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id')
    .eq('integration_id', integrationId)
    .eq('banca_id', bancaId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Para `create_new`: copia token de outra integração já vinculada a pelo menos uma das bancas alvo.
 * Ordem: `explicitSourceId` (se válido e compartilha banca), depois outras integrações da `bancaId` de contexto.
 */
async function resolveTokenCopySourceForNewIntegration(
  contextBancaId: string,
  desiredBancaIds: string[],
  explicitSourceId?: string | null
): Promise<{ access_token_encrypted: string; token_last4: string | null } | null> {
  const desired = new Set(
    (desiredBancaIds.length ? desiredBancaIds : [contextBancaId]).map((x) => String(x).trim()).filter(Boolean)
  );
  if (desired.size === 0) return null;

  const candidateIds: string[] = [];
  const push = (id: string) => {
    const s = String(id).trim();
    if (s && !candidateIds.includes(s)) candidateIds.push(s);
  };

  if (explicitSourceId?.trim()) push(explicitSourceId.trim());
  for (const id of await listIntegrationIdsByBanca(contextBancaId)) push(id);

  for (const integrationId of candidateIds) {
    const linked = await listBancasByIntegration(integrationId);
    if (!linked.some((b) => desired.has(b))) continue;

    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('access_token_encrypted, token_last4')
      .eq('id', integrationId)
      .maybeSingle();

    if (error || !data) continue;
    const enc = (data as { access_token_encrypted?: string | null }).access_token_encrypted;
    if (enc != null && String(enc).trim() !== '') {
      return {
        access_token_encrypted: String(enc),
        token_last4: (data as { token_last4?: string | null }).token_last4 ?? null,
      };
    }
  }
  return null;
}

export type DecryptTokenOptions = { requireActive?: boolean };

export async function getDecryptedTokenByIntegrationId(
  integrationId: string,
  options?: DecryptTokenOptions
): Promise<string | null> {
  const requireActive = options?.requireActive !== false;
  let q = supabaseServiceRole
    .from('meta_integration_configs')
    .select('access_token_encrypted')
    .eq('id', integrationId);
  if (requireActive) q = q.eq('is_active', true);
  const { data } = await q.maybeSingle();
  const encrypted = data?.access_token_encrypted as string | null | undefined;
  if (!encrypted) return null;
  try {
    return encryptionService.decrypt(encrypted);
  } catch {
    return null;
  }
}

async function resolveMetaApiContextByIntegrationId(integrationId: string): Promise<{
  baseUrl: string;
  adAccountId: string | null;
  blockedAdAccountIds: string | null;
}> {
  const { data } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('base_url, ad_account_id, blocked_ad_account_ids')
    .eq('id', integrationId)
    .maybeSingle();
  return {
    baseUrl: (data?.base_url as string) || DEFAULT_BASE_URL,
    adAccountId: (data?.ad_account_id as string) || null,
    blockedAdAccountIds: (data?.blocked_ad_account_ids as string | null) ?? null,
  };
}

export async function getLegacyDecryptedToken(bancaId: string, requireActive = true): Promise<string | null> {
  let q = supabaseServiceRole
    .from('meta_integrations')
    .select('access_token_encrypted')
    .eq('banca_id', bancaId);
  if (requireActive) q = q.eq('is_active', true);
  const { data } = await q.maybeSingle();
  const encrypted = data?.access_token_encrypted as string | null | undefined;
  if (!encrypted) return null;
  try {
    return encryptionService.decrypt(encrypted);
  } catch {
    return null;
  }
}

/** Moeda da conta Meta (integração compartilhada ou legado por banca). */
export async function getMetaCurrencyForBanca(bancaId: string): Promise<string> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const { data } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('currency')
      .eq('id', integrationId)
      .maybeSingle();
    if (data?.currency) return String(data.currency);
  }
  const { data: leg } = await supabaseServiceRole
    .from('meta_integrations')
    .select('currency')
    .eq('banca_id', bancaId)
    .maybeSingle();
  return (leg?.currency as string) || 'BRL';
}

/** Modelo legado (por banca): ainda usado quando não há linha em meta_integration_bancas. */
async function getLegacyMetaIntegrationByBanca(bancaId: string): Promise<MetaIntegrationRow | null> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integrations')
    .select(
      'id, banca_id, base_url, access_token_encrypted, token_last4, ad_account_id, blocked_ad_account_ids, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset'
    )
    .eq('banca_id', bancaId)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    id: String(d.id),
    banca_id: bancaId,
    base_url: String(d.base_url ?? DEFAULT_BASE_URL),
    access_token_encrypted: (d.access_token_encrypted as string | null) ?? null,
    token_last4: (d.token_last4 as string | null) ?? null,
    ad_account_id: (d.ad_account_id as string | null) ?? null,
    blocked_ad_account_ids: (d.blocked_ad_account_ids as string | null) ?? null,
    pixel_id: (d.pixel_id as string | null) ?? null,
    default_campaign_id: (d.default_campaign_id as string | null) ?? null,
    is_active: d.is_active !== false,
    currency: (d.currency as string | null) ?? null,
    last_sync_at: (d.last_sync_at as string | null) ?? null,
    last_sync_error: (d.last_sync_error as string | null) ?? null,
    last_sync_date_preset: (d.last_sync_date_preset as string | null) ?? null,
    banca_ids: [bancaId],
  };
}

/** base_url e ad_account: primeira integração vinculada à banca ou legado. */
async function resolveMetaApiContext(bancaId: string): Promise<{
  baseUrl: string;
  adAccountId: string | null;
  blockedAdAccountIds: string | null;
}> {
  const ids = await listIntegrationIdsByBanca(bancaId);
  if (ids.length > 0) {
    return resolveMetaApiContextByIntegrationId(ids[0]);
  }
  const { data: leg } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url, ad_account_id, blocked_ad_account_ids')
    .eq('banca_id', bancaId)
    .maybeSingle();
  return {
    baseUrl: (leg?.base_url as string) || DEFAULT_BASE_URL,
    adAccountId: (leg?.ad_account_id as string) || null,
    blockedAdAccountIds: (leg?.blocked_ad_account_ids as string | null) ?? null,
  };
}

export async function listMetaIntegrationsForBanca(bancaId: string): Promise<MetaIntegrationRow[]> {
  const rows: MetaIntegrationRow[] = [];
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select(
        'id, base_url, token_last4, ad_account_id, blocked_ad_account_ids, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset, access_token_encrypted'
      )
      .eq('id', integrationId)
      .maybeSingle();
    if (error || !data) continue;
    const banca_ids = await listBancasByIntegration(integrationId);
    rows.push({ ...(data as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow);
  }
  const leg = await getLegacyMetaIntegrationByBanca(bancaId);
  if (leg) {
    const dup = rows.some((r) => String(r.id) === String(leg.id));
    if (!dup) rows.push(leg);
  }
  return rows;
}

export async function getMetaConfig(bancaId: string): Promise<MetaIntegrationRow | null> {
  const list = await listMetaIntegrationsForBanca(bancaId);
  return list[0] ?? null;
}

export type MetaConfigForBancasResult =
  | { ok: true; mode: 'unconfigured'; banca_ids: string[] }
  | { ok: true; mode: 'configured'; row: MetaIntegrationRow }
  | { ok: false; error: string };

/**
 * Resolve uma única integração Meta para um conjunto de bancas.
 * Bancas sem vínculo são ignoradas na detecção de conflito (útil para incluir novas bancas no mesmo save).
 */
export async function getMetaConfigForBancaIds(bancaIds: string[]): Promise<MetaConfigForBancasResult> {
  const unique = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (unique.length === 0) {
    return { ok: true, mode: 'unconfigured', banca_ids: [] };
  }

  /** Não bloquear GET com várias bancas só porque alguma tem N integrações: usamos a primeira por banca em `resolveIntegrationIdByBanca` e validamos conflitos abaixo. */

  const integrationIdByBanca = new Map<string, string | null>();
  for (const bid of unique) {
    integrationIdByBanca.set(bid, await resolveIntegrationIdByBanca(bid));
  }

  const linkedIds = [...integrationIdByBanca.values()].filter((x): x is string => Boolean(x));
  const distinctIntegrationIds = Array.from(new Set(linkedIds));

  if (distinctIntegrationIds.length === 0) {
    const legacyEntries: { row: MetaIntegrationRow }[] = [];
    for (const bid of unique) {
      const row = await getLegacyMetaIntegrationByBanca(bid);
      if (row) legacyEntries.push({ row });
    }
    if (legacyEntries.length === 0) {
      return { ok: true, mode: 'unconfigured', banca_ids: unique };
    }
    const legacyIds = Array.from(new Set(legacyEntries.map((e) => e.row.id)));
    if (legacyIds.length > 1) {
      return {
        ok: false,
        error:
          'As bancas selecionadas têm cadastros Meta antigos (meta_integrations) diferentes. Edite uma banca por vez ou unifique no modelo compartilhado.',
      };
    }
    const baseRow = legacyEntries[0].row;
    return {
      ok: true,
      mode: 'configured',
      row: { ...baseRow, banca_ids: unique, banca_id: baseRow.banca_id },
    };
  }

  if (distinctIntegrationIds.length > 1) {
    return {
      ok: false,
      error:
        'As bancas selecionadas estão vinculadas a integrações Meta diferentes. Selecione apenas bancas que compartilham a mesma integração ou edite uma por vez.',
    };
  }

  const integrationId = distinctIntegrationIds[0];
  const bancaComVinculo = unique.find((b) => integrationIdByBanca.get(b) === integrationId);
  if (!bancaComVinculo) {
    return { ok: true, mode: 'unconfigured', banca_ids: unique };
  }

  const row = await getMetaConfig(bancaComVinculo);
  if (!row) {
    return { ok: true, mode: 'unconfigured', banca_ids: unique };
  }
  return { ok: true, mode: 'configured', row };
}

export type UpsertMetaConfigOptions = {
  /** Qual integração editar quando a banca tem várias (UUID de meta_integration_configs). */
  integration_id?: string | null;
  /** Cria nova integração + vínculo(s); não altera configs existentes. */
  create_new?: boolean;
  /**
   * Com `create_new` e sem `access_token` no body: copia o token criptografado desta integração,
   * desde que ela compartilhe vínculo com alguma das bancas alvo. Se omitido, usa a primeira integração irmã da banca de contexto.
   */
  reuse_token_from_integration_id?: string | null;
};

export async function upsertMetaConfig(
  bancaId: string,
  input: MetaConfigInput,
  bancaIdsToLink?: string[] | null,
  options?: UpsertMetaConfigOptions
): Promise<MetaIntegrationRow> {
  const baseUrl = input.base_url?.trim() || DEFAULT_BASE_URL;
  const now = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    base_url: baseUrl,
    pixel_id: input.pixel_id?.trim() || null,
    default_campaign_id: input.default_campaign_id?.trim() || null,
    is_active: input.is_active ?? true,
    updated_at: now,
  };

  if (input.ad_account_id !== undefined) {
    updatePayload.ad_account_id = input.ad_account_id?.trim() || null;
  }

  if (input.blocked_ad_account_ids !== undefined) {
    updatePayload.blocked_ad_account_ids = input.blocked_ad_account_ids?.trim() || null;
  }

  if (input.access_token?.trim()) {
    const token = input.access_token.trim();
    updatePayload.access_token_encrypted = encryptionService.encrypt(token);
    updatePayload.token_last4 = token.length >= 4 ? token.slice(-4) : '****';
  }

  if (options?.create_new) {
    const desiredBancas =
      Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0
        ? Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)))
        : [bancaId];

    if (!input.access_token?.trim()) {
      const copied = await resolveTokenCopySourceForNewIntegration(
        bancaId,
        desiredBancas,
        options.reuse_token_from_integration_id
      );
      if (copied) {
        updatePayload.access_token_encrypted = copied.access_token_encrypted;
        if (copied.token_last4 != null && String(copied.token_last4).trim() !== '') {
          updatePayload.token_last4 = copied.token_last4;
        }
      } else {
        throw new Error(
          'Nova integração sem token: informe um Access Token ou mantenha outra integração Meta nesta banca para reutilizar o token existente.'
        );
      }
    }

    const { data: created, error: createError } = await supabaseServiceRole
      .from('meta_integration_configs')
      .insert({ ...updatePayload })
      .select()
      .single();
    if (createError) throw new Error(createError.message);
    const newIntegrationId = String((created as { id: string }).id);
    await supabaseServiceRole
      .from('meta_integration_bancas')
      .insert(desiredBancas.map((id) => ({ integration_id: newIntegrationId, banca_id: id })));
    const banca_ids = await listBancasByIntegration(newIntegrationId);
    return { ...(created as MetaIntegrationRow), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
  }

  let targetIntegrationId =
    options?.integration_id != null && String(options.integration_id).trim() !== ''
      ? String(options.integration_id).trim()
      : null;

  const idsOnBanca = await listIntegrationIdsByBanca(bancaId);
  if (!targetIntegrationId) {
    if (idsOnBanca.length === 1) {
      targetIntegrationId = idsOnBanca[0];
    } else if (idsOnBanca.length > 1) {
      throw new Error(
        'Esta banca tem várias integrações Meta. Envie integration_id no corpo da requisição para indicar qual alterar, ou create_new_integration: true para cadastrar outra conta de anúncio.'
      );
    }
  } else {
    const linked = await listBancasByIntegration(targetIntegrationId);
    if (!linked.includes(bancaId)) {
      throw new Error('integration_id informado não está vinculado a esta banca.');
    }
  }

  const existingIntegrationId = targetIntegrationId;

  // Atualiza config existente (uma vez) e atualiza vínculos (opcional)
  if (existingIntegrationId) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .update(updatePayload)
      .eq('id', existingIntegrationId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0) {
      // Substitui o conjunto de bancas vinculadas (remove ausentes e adiciona novas)
      const desired = Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)));

      const current = await listBancasByIntegration(existingIntegrationId);
      const currentSet = new Set(current);
      const desiredSet = new Set(desired);

      const toRemove = current.filter((id) => !desiredSet.has(id));
      const toAdd = desired.filter((id) => !currentSet.has(id));

      if (toRemove.length > 0) {
        await supabaseServiceRole
          .from('meta_integration_bancas')
          .delete()
          .eq('integration_id', existingIntegrationId)
          .in('banca_id', toRemove);
      }
      if (toAdd.length > 0) {
        await supabaseServiceRole
          .from('meta_integration_bancas')
          .insert(toAdd.map((id) => ({ integration_id: existingIntegrationId, banca_id: id })));
      }
    }

    const banca_ids = await listBancasByIntegration(existingIntegrationId);
    return { ...(data as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
  }

  // Cria nova integração + vínculo
  const { data: created, error: createError } = await supabaseServiceRole
    .from('meta_integration_configs')
    .insert({ ...updatePayload })
    .select()
    .single();
  if (createError) throw new Error(createError.message);

  const integrationId = String((created as any).id);
  const desired = Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0
    ? Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)))
    : [bancaId];

  await supabaseServiceRole
    .from('meta_integration_bancas')
    .insert(desired.map((id) => ({ integration_id: integrationId, banca_id: id })));

  const banca_ids = await listBancasByIntegration(integrationId);
  return { ...(created as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
}

/**
 * Remove linhas legadas `meta_integrations` das bancas que não têm mais nenhum vínculo em
 * `meta_integration_bancas`. Evita que a visão geral continue exibindo integração após desvincular
 * no modelo compartilhado.
 */
export async function cleanupLegacyMetaIntegrationsWithNoSharedLink(bancaIds: string[]): Promise<void> {
  const ids = Array.from(new Set(bancaIds.map((x) => String(x ?? '').trim()).filter(Boolean)));
  if (ids.length === 0) return;

  const { data: stillLinked, error: linkErr } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('banca_id')
    .in('banca_id', ids);
  if (linkErr) throw new Error(linkErr.message);

  const hasShared = new Set(
    (stillLinked ?? []).map((r: { banca_id: string }) => String(r.banca_id).trim()).filter(Boolean)
  );
  const orphanBancaIds = ids.filter((bid) => !hasShared.has(bid));
  if (orphanBancaIds.length === 0) return;

  const { error: delErr } = await supabaseServiceRole
    .from('meta_integrations')
    .delete()
    .in('banca_id', orphanBancaIds);
  if (delErr) throw new Error(delErr.message);
}

/**
 * Substitui apenas os vínculos meta_integration_bancas (não altera token nem outros campos da config).
 * Exige ao menos uma banca; para zerar vínculos, use deleteMetaIntegrationConfig.
 */
export async function setMetaIntegrationBancaLinks(integrationId: string, bancaIds: string[]): Promise<string[]> {
  const id = String(integrationId).trim();
  const desired = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!id) throw new Error('integration_id é obrigatório.');
  if (desired.length === 0) {
    throw new Error('Informe ao menos uma banca vinculada, ou remova a integração inteira.');
  }

  const { data: exists, error: exErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!exists) throw new Error('Integração Meta não encontrada.');

  const current = await listBancasByIntegration(id);
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);

  const toRemove = current.filter((bid) => !desiredSet.has(bid));
  const toAdd = desired.filter((bid) => !currentSet.has(bid));

  if (toRemove.length > 0) {
    const { error: delErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .delete()
      .eq('integration_id', id)
      .in('banca_id', toRemove);
    if (delErr) throw new Error(delErr.message);
    await cleanupLegacyMetaIntegrationsWithNoSharedLink(toRemove);
  }
  if (toAdd.length > 0) {
    const { error: insErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .insert(toAdd.map((bid) => ({ integration_id: id, banca_id: bid })));
    if (insErr) throw new Error(insErr.message);
  }

  return listBancasByIntegration(id);
}

/**
 * Atualiza os vínculos da integração alvo e move as bancas informadas
 * removendo vínculos dessas bancas em outras integrações.
 */
export async function moveMetaIntegrationToBancas(integrationId: string, bancaIds: string[]): Promise<string[]> {
  const id = String(integrationId).trim();
  const desired = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!id) throw new Error('integration_id é obrigatório.');
  if (desired.length === 0) {
    throw new Error('Informe ao menos uma banca vinculada, ou remova a integração inteira.');
  }

  const { data: exists, error: exErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!exists) throw new Error('Integração Meta não encontrada.');

  // Remove vínculos dessas bancas em outras integrações para "mover" de fato.
  const { data: conflictingLinks, error: conflictErr } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id, banca_id')
    .in('banca_id', desired)
    .neq('integration_id', id);
  if (conflictErr) throw new Error(conflictErr.message);

  for (const link of conflictingLinks ?? []) {
    const otherIntegrationId = String((link as { integration_id: string }).integration_id);
    const bancaId = String((link as { banca_id: string }).banca_id);
    const { error: delErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .delete()
      .eq('integration_id', otherIntegrationId)
      .eq('banca_id', bancaId);
    if (delErr) throw new Error(delErr.message);
  }

  return setMetaIntegrationBancaLinks(id, desired);
}

/**
 * Remove integração Meta: primeiro `meta_integration_configs` (modelo compartilhado;
 * vínculos em `meta_integration_bancas` caem por CASCADE), senão `meta_integrations` (legado por banca).
 * A UI lista os dois tipos com `integration_id` = id da respectiva tabela.
 */
export async function deleteMetaIntegrationConfig(integrationId: string): Promise<void> {
  const id = String(integrationId).trim();
  if (!id) throw new Error('integration_id é obrigatório.');

  const linkedBeforeShared = await listBancasByIntegration(id);

  const { data: cfgDeleted, error: cfgErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .delete()
    .eq('id', id)
    .select('id');
  if (cfgErr) throw new Error(cfgErr.message);
  if (cfgDeleted?.length) {
    await cleanupLegacyMetaIntegrationsWithNoSharedLink(linkedBeforeShared);
    return;
  }

  const { data: legRow } = await supabaseServiceRole
    .from('meta_integrations')
    .select('banca_id')
    .eq('id', id)
    .maybeSingle();
  const legacyBancaId =
    legRow && (legRow as { banca_id?: string }).banca_id
      ? String((legRow as { banca_id: string }).banca_id)
      : '';

  const { data: legDeleted, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .delete()
    .eq('id', id)
    .select('id');
  if (legErr) throw new Error(legErr.message);
  if (!legDeleted?.length) throw new Error('Integração Meta não encontrada ou já removida.');
  if (legacyBancaId) await cleanupLegacyMetaIntegrationsWithNoSharedLink([legacyBancaId]);
}

/** Primeiro token válido entre todas as integrações da banca; senão legado. */
export async function getDecryptedToken(bancaId: string): Promise<string | null> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const t = await getDecryptedTokenByIntegrationId(integrationId);
    if (t) return t;
  }
  return getLegacyDecryptedToken(bancaId, true);
}

/**
 * Revelação admin: mesma ordem de `getDecryptedToken`, porém inclui linhas inativas
 * (token existe no banco mas is_active = false) e valida descriptografia.
 */
export async function getDecryptedTokenForReveal(bancaId: string): Promise<string | null> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const t = await getDecryptedTokenByIntegrationId(integrationId, { requireActive: false });
    if (t) return t;
  }
  return getLegacyDecryptedToken(bancaId, false);
}

export async function testConnection(
  bancaId: string,
  integrationId?: string | null
): Promise<{
  success: boolean;
  me?: { id: string; name?: string };
  adAccounts?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = integrationId
    ? await getDecryptedTokenByIntegrationId(integrationId)
    : await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado ou inválido. Configure o token primeiro.' };
  }

  const { baseUrl } = integrationId
    ? await resolveMetaApiContextByIntegrationId(integrationId)
    : await resolveMetaApiContext(bancaId);

  try {
    const me = await getMe(baseUrl, token);
    const adAccounts = await getAdAccounts(baseUrl, token);
    logMetaReturn('testConnection ← Meta', {
      banca_id: bancaId,
      base_url_host: (() => {
        try {
          return new URL(baseUrl).host;
        } catch {
          return 'invalid';
        }
      })(),
      me: { id: me.id, name: me.name ?? null },
      ad_accounts_count: adAccounts.length,
      ad_accounts_sample: adAccounts.slice(0, 5).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        account_status: a.account_status ?? null,
        currency: a.currency ?? null,
      })),
    });
    return {
      success: true,
      me: { id: me.id, name: me.name },
      adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.name })),
    };
  } catch (err: any) {
    logMetaReturn('testConnection ✗ Meta', { banca_id: bancaId, error: err?.message ?? String(err) });
    return { success: false, error: err?.message || 'Erro ao conectar com a Meta API' };
  }
}

export async function loadCampaigns(
  bancaId: string,
  integrationId?: string | null
): Promise<{
  success: boolean;
  campaigns?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = integrationId
    ? await getDecryptedTokenByIntegrationId(integrationId)
    : await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const { baseUrl, adAccountId: adAccountIdRaw, blockedAdAccountIds } = integrationId
    ? await resolveMetaApiContextByIntegrationId(integrationId)
    : await resolveMetaApiContext(bancaId);
  const configuredActs = parseConfiguredAdAccountIds(adAccountIdRaw ?? undefined, blockedAdAccountIds);
  const adAccountId = configuredActs[0];
  if (!adAccountId) {
    return { success: false, error: 'Ad Account ID não configurado.' };
  }

  try {
    const campaigns = await listCampaigns(baseUrl, token, adAccountId);
    const adAcct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    logMetaReturn('loadCampaigns ← Meta', {
      banca_id: bancaId,
      ad_account_id: adAcct,
      campaigns_count: campaigns.length,
      campaigns_sample: campaigns.slice(0, 8).map((c) => ({
        id: c.id,
        name: c.name ?? null,
        status: c.status ?? null,
        effective_status: c.effective_status ?? null,
      })),
    });
    return {
      success: true,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    };
  } catch (err: any) {
    logMetaReturn('loadCampaigns ✗ Meta', { banca_id: bancaId, error: err?.message ?? String(err) });
    return { success: false, error: err?.message || 'Erro ao carregar campanhas' };
  }
}

export interface MetaInsightsAggregated {
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  currency: string;
}

export async function getMetaInsightsAggregated(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<MetaInsightsAggregated | null> {
  const [campaignsResult, currency] = await Promise.all([
    activeOnly
      ? supabaseServiceRole
          .from('meta_campaigns')
          .select('campaign_id')
          .eq('banca_id', bancaId)
          .or('effective_status.eq.ACTIVE,status.eq.ACTIVE')
      : Promise.resolve({ data: null }),
    getMetaCurrencyForBanca(bancaId),
  ]);

  let campaignIds: string[] | null = null;
  if (activeOnly) {
    const ids: string[] = ((campaignsResult as any).data || []).map((c: { campaign_id: string }) => c.campaign_id);
    if (ids.length === 0) return null;
    campaignIds = ids;
  }

  let query = supabaseServiceRole
    .from('meta_insights_daily')
    .select('campaign_id, reach, impressions, clicks, leads, spend')
    .eq('banca_id', bancaId);

  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  if (campaignIds && campaignIds.length > 0) query = query.in('campaign_id', campaignIds);

  const { data, error } = await query;
  if (error || !data?.length) return null;

  if (isMetaVerboseLogEnabled()) {
    const firstInsight = data[0] as Record<string, unknown>;
    console.log('[Meta Ads] getMetaInsightsAggregated', {
      bancaId,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      activeOnly,
      rows: data.length,
    });
  }

  const aggregated = data.reduce(
    (acc, row) => ({
      reach: acc.reach + (Number(row.reach) || 0),
      impressions: acc.impressions + (Number(row.impressions) || 0),
      clicks: acc.clicks + (Number(row.clicks) || 0),
      leads: acc.leads + (Number(row.leads) || 0),
      spend: acc.spend + (Number(row.spend) || 0),
    }),
    { reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 }
  );

  return { ...aggregated, currency };
}

export interface MetaCampaignWithMetrics {
  campaign_id: string;
  campaign_name: string;
  adsets: string[];
  reach: number;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  results: number;
  cost_per_result: number | null;
  assigned_consultors?: Array<{
    id: string;
    email: string;
    full_name: string | null;
    total_leads: number;
    total_deposited: number;
  }>;
  consultor_total_leads?: number;
  consultor_total_deposited?: number;
  /** Consultores atribuídos via "card Ads" (ads_attribution_consultor_ids) no admin/meta. */
  ads_attribution_consultors?: Array<{ id: string; email: string; full_name: string | null }>;
}

const META_RESULT_ACTION_TYPES = new Set([
  'lead',
  'omni_lead',
  'leadgen_grouped',
  'purchase',
  'complete_registration',
  'app_install',
  'subscribe',
  'contact',
  'submit_application',
]);

function extractResultsFromRawActions(rawActions: Array<{ action_type: string; value: string }> | null | undefined): number {
  if (!rawActions || !Array.isArray(rawActions)) return 0;
  return rawActions
    .filter((a) => META_RESULT_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value || '0', 10) || 0), 0);
}

async function resolveAdsAttributionConsultorsByCampaign(
  bancaId: string,
  campaignIds: string[]
): Promise<Map<string, Array<{ id: string; email: string; full_name: string | null }>>> {
  const result = new Map<string, Array<{ id: string; email: string; full_name: string | null }>>();
  if (!campaignIds.length) return result;
  try {
    const { data: rows } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, ads_attribution_consultor_ids')
      .eq('banca_id', bancaId)
      .in('campaign_id', campaignIds);
    if (!rows?.length) return result;
    const allIds = new Set<string>();
    const idsByCampaign = new Map<string, string[]>();
    for (const row of rows) {
      const ids = Array.isArray((row as any).ads_attribution_consultor_ids)
        ? (row as any).ads_attribution_consultor_ids.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
        : [];
      if (ids.length) {
        idsByCampaign.set(String((row as any).campaign_id), ids);
        ids.forEach((id: string) => allIds.add(id));
      }
    }
    if (!allIds.size) return result;
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .in('id', Array.from(allIds));
    const profileMap = new Map<string, { id: string; email: string; full_name: string | null }>();
    for (const p of profiles ?? []) {
      profileMap.set(String((p as any).id), {
        id: String((p as any).id),
        email: String((p as any).email ?? ''),
        full_name: (p as any).full_name ?? null,
      });
    }
    for (const [campId, ids] of idsByCampaign) {
      const resolved = ids.map((id) => profileMap.get(id)).filter((p): p is { id: string; email: string; full_name: string | null } => Boolean(p));
      if (resolved.length) result.set(campId, resolved);
    }
  } catch {
    // non-critical
  }
  return result;
}

export async function getMetaCampaignsWithInsights(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<MetaCampaignWithMetrics[]> {
  let campaignsQuery = supabaseServiceRole
    .from('meta_campaigns')
    .select('campaign_id, name')
    .eq('banca_id', bancaId);
  if (activeOnly) {
    campaignsQuery = campaignsQuery.or('effective_status.eq.ACTIVE,status.eq.ACTIVE');
  }
  const { data: campaigns } = await campaignsQuery;
  if (!campaigns?.length) return [];

  const campaignIds = campaigns.map((c: { campaign_id: string }) => c.campaign_id);

  const { data: adsets } = await supabaseServiceRole
    .from('meta_adsets')
    .select('campaign_id, name')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);

  const adsetsByCampaign = new Map<string, string[]>();
  (adsets || []).forEach((a: { campaign_id: string; name: string | null }) => {
    const list = adsetsByCampaign.get(a.campaign_id) || [];
    if (a.name) list.push(a.name);
    adsetsByCampaign.set(a.campaign_id, list);
  });

  let insightsQuery = supabaseServiceRole
    .from('meta_insights_daily')
    .select('campaign_id, campaign_name, reach, impressions, clicks, spend, leads, raw_actions')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  if (dateFrom) insightsQuery = insightsQuery.gte('date', dateFrom);
  if (dateTo) insightsQuery = insightsQuery.lte('date', dateTo);

  const { data: insights } = await insightsQuery;
  const campaignIdsForSummary = campaigns.map((c: { campaign_id: string }) => c.campaign_id);
  const [consultorSummaryByCampaign, adsAttributionByCampaign] = await Promise.all([
    buildCampaignConsultorSummary(bancaId, campaignIdsForSummary, dateFrom ?? null, dateTo ?? null),
    resolveAdsAttributionConsultorsByCampaign(bancaId, campaignIdsForSummary),
  ]);

  if (!insights?.length) {
    return campaigns.map((c: { campaign_id: string; name: string | null }) => {
      const consultorSummary = consultorSummaryByCampaign.get(c.campaign_id);
      return {
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
      cost_per_result: null,
      assigned_consultors: consultorSummary?.assigned_consultors ?? [],
      consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
      consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
      ads_attribution_consultors: adsAttributionByCampaign.get(c.campaign_id) ?? [],
    };
    });
  }

  if (isMetaVerboseLogEnabled()) {
    console.log('[Meta Ads] getMetaCampaignsWithInsights', {
      bancaId,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      activeOnly,
      campaignCount: campaigns.length,
      insightsRows: insights.length,
    });
  }

  const metricsByCampaign = new Map<string, { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }>();
  insights.forEach((row: { campaign_id: string; campaign_name?: string | null; reach?: number; impressions?: number; clicks?: number; spend?: number; leads?: number; raw_actions?: Array<{ action_type: string; value: string }> | null }) => {
    const cur = metricsByCampaign.get(row.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
    cur.reach += Number(row.reach) || 0;
    cur.impressions += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.spend += Number(row.spend) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.results += extractResultsFromRawActions(row.raw_actions);
    metricsByCampaign.set(row.campaign_id, cur);
  });

  return campaigns.map((c: { campaign_id: string; name: string | null }) => {
    const m = metricsByCampaign.get(c.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
    const consultorSummary = consultorSummaryByCampaign.get(c.campaign_id);
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: m.reach,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.spend,
      leads: m.leads,
      results: m.results,
      cost_per_result: m.results > 0 ? m.spend / m.results : null,
      assigned_consultors: consultorSummary?.assigned_consultors ?? [],
      consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
      consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
      ads_attribution_consultors: adsAttributionByCampaign.get(c.campaign_id) ?? [],
    };
  });
}

function leadsFromMetaInsightActions(actions: MetaInsight['actions']): number {
  if (!actions?.length) return 0;
  const lead = actions.find((a) => a.action_type === 'lead');
  return lead ? parseInt(lead.value || '0', 10) || 0 : 0;
}

function extractResultsFromInsightActions(actions: MetaInsight['actions']): number {
  if (!actions?.length) return 0;
  return actions
    .filter((a) => META_RESULT_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value || '0', 10) || 0), 0);
}

/**
 * Gestão de Tráfego: métricas Meta em tempo real via Graph API (insights diários por campanha).
 * Atribuição de consultores continua vinda do CRM (`buildCampaignConsultorSummary`).
 */
export async function fetchGestorMetaDashboardFromGraph(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<{
  success: boolean;
  metaFunnel: MetaInsightsAggregated | null;
  metaCampaignsData: MetaCampaignWithMetrics[];
  error?: string;
}> {
  try {
    const token = await getDecryptedToken(bancaId);
    if (!token) {
      return { success: false, metaFunnel: null, metaCampaignsData: [], error: 'Token Meta não configurado.' };
    }
    const { baseUrl, adAccountId } = await resolveMetaApiContext(bancaId);
    if (!adAccountId) {
      return { success: false, metaFunnel: null, metaCampaignsData: [], error: 'Ad Account Meta não configurado.' };
    }

    const timeRange =
      dateFrom && dateTo
        ? { since: dateFrom, until: dateTo }
        : (() => {
            const now = new Date();
            const until = formatMetaDate(now);
            const since = new Date(now);
            since.setDate(since.getDate() - 29);
            return { since: formatMetaDate(since), until };
          })();

    const [insights, graphCampaigns, graphAdsets, currency] = await Promise.all([
      getInsightsDaily(baseUrl, token, adAccountId, timeRange),
      listCampaigns(baseUrl, token, adAccountId),
      listAdSets(baseUrl, token, adAccountId),
      getMetaCurrencyForBanca(bancaId),
    ]);

    const visibleCampaigns = graphCampaigns.filter((c) => {
      if (!activeOnly) return true;
      return c.status === 'ACTIVE' || c.effective_status === 'ACTIVE';
    });
    const allowedIds = new Set(visibleCampaigns.map((c) => String(c.id)));

    const filteredInsights = insights.filter(
      (ins) => ins.campaign_id && allowedIds.has(String(ins.campaign_id))
    );

    let reach = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;
    let spend = 0;
    for (const ins of filteredInsights) {
      reach += parseInt(ins.reach || '0', 10) || 0;
      impressions += parseInt(ins.impressions || '0', 10) || 0;
      clicks += parseInt(ins.clicks || '0', 10) || 0;
      spend += parseFloat(ins.spend || '0') || 0;
      leads += leadsFromMetaInsightActions(ins.actions);
    }

    const metaFunnel: MetaInsightsAggregated = { reach, impressions, clicks, leads, spend, currency };

    const adsetsByCampaign = new Map<string, string[]>();
    for (const a of graphAdsets) {
      const cid = String(a.campaign_id || '');
      if (!cid || !allowedIds.has(cid)) continue;
      const list = adsetsByCampaign.get(cid) || [];
      if (a.name) list.push(a.name);
      adsetsByCampaign.set(cid, list);
    }

    const metricsByCampaign = new Map<
      string,
      { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }
    >();
    for (const ins of filteredInsights) {
      const cid = String(ins.campaign_id);
      const cur = metricsByCampaign.get(cid) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
      cur.reach += parseInt(ins.reach || '0', 10) || 0;
      cur.impressions += parseInt(ins.impressions || '0', 10) || 0;
      cur.clicks += parseInt(ins.clicks || '0', 10) || 0;
      cur.spend += parseFloat(ins.spend || '0') || 0;
      cur.leads += leadsFromMetaInsightActions(ins.actions);
      cur.results += extractResultsFromInsightActions(ins.actions);
      metricsByCampaign.set(cid, cur);
    }

    const orderedIds = visibleCampaigns.map((c) => String(c.id));
    const [consultorSummaryByCampaign, adsAttributionByCampaign] = await Promise.all([
      buildCampaignConsultorSummary(bancaId, orderedIds, dateFrom ?? null, dateTo ?? null),
      resolveAdsAttributionConsultorsByCampaign(bancaId, orderedIds),
    ]);

    const metaCampaignsData: MetaCampaignWithMetrics[] = visibleCampaigns.map((c) => {
      const id = String(c.id);
      const m = metricsByCampaign.get(id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
      const consultorSummary = consultorSummaryByCampaign.get(id);
      return {
        campaign_id: id,
        campaign_name: c.name || id,
        adsets: adsetsByCampaign.get(id) || [],
        reach: m.reach,
        impressions: m.impressions,
        clicks: m.clicks,
        spend: m.spend,
        leads: m.leads,
        results: m.results,
        cost_per_result: m.results > 0 ? m.spend / m.results : null,
        assigned_consultors: consultorSummary?.assigned_consultors ?? [],
        consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
        consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
        ads_attribution_consultors: adsAttributionByCampaign.get(id) ?? [],
      };
    });

    metaCampaignsData.sort((a, b) => b.spend - a.spend);

    return { success: true, metaFunnel, metaCampaignsData };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Gestor Meta Live] Graph falhou:', msg);
    return { success: false, metaFunnel: null, metaCampaignsData: [], error: msg };
  }
}

/** Job único por integração (token Meta) para o painel admin — evita chamadas duplicadas. */
export type AdminMetaLiveJob =
  | { kind: 'shared'; integrationId: string; representativeBancaId: string; linkedBancaIds: string[] }
  | { kind: 'legacy'; representativeBancaId: string; linkedBancaIds: string[] };

export interface AdminMetaLiveCampaignRow {
  banca_id: string;
  banca_name: string;
  banca_url: string | null;
  /** Gestor de tráfego na banca (`user_bancas`), até um perfil — preenchido em `enrichAdminMetaCampaignRowsWithBancaNames`. */
  gestor_names?: string[];
  /** ID `profiles.id` do mesmo gestor (mesmo escopo que `gestor_names`). */
  gestor_user_ids?: string[];
  campaign_id: string;
  /** Tipo salvo em `meta_campaigns` (sincronizado). */
  campaign_kind: 'normal' | 'bolao';
  name: string;
  objective: string | null;
  status: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  start_time: string | null;
  stop_time: string | null;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  results: number;
  /**
   * Gasto na moeda nativa da Ad Account (vide `currency`). Para Ad Accounts em USD,
   * vem em USD. Para BRL, em BRL. **Nunca somar entre moedas distintas sem converter.**
   */
  spend: number;
  /**
   * Código ISO da moeda usada para apresentar/converter esta linha.
   * Prioridade:
   *  1. `currency_override` salvo em meta_campaigns (escolha manual no admin).
   *  2. Moeda nativa da Ad Account devolvida pela Meta.
   *  3. `null` quando indisponível.
   */
  currency: string | null;
  /**
   * Moeda nativa da Ad Account na Meta (sempre a mesma para o `spend` bruto do insight).
   * Permite à UI contrastar com `currency`/`currency_override` quando há override manual.
   */
  currency_account: string | null;
  /**
   * Override manual salvo em meta_campaigns.currency_override (BRL | USD).
   * `null` ⇒ usar a moeda nativa da Ad Account.
   * Exposto para a UI conseguir refletir o estado atual no select.
   */
  currency_override: string | null;
  /**
   * `spend` convertido para BRL usando a cotação atual (USD-BRL via AwesomeAPI).
   * - Se `currency` (efetiva) == 'BRL' ou `null`, retorna o próprio `spend`.
   * - Se a moeda não tem cotação configurada, fica igual ao `spend` e gera log de aviso.
   * Os totais agregados sempre usam este campo para consolidar em reais.
   */
  spend_brl: number;
  integration_id: string | null;
  ad_account_id: string | null;
  insights_source: string | null;
}

export interface AdminMetaLiveIntegrationTrace {
  integration_id: string | null;
  representative_banca_id: string;
  ad_account_id: string | null;
  insights_source: string | null;
  billing_accounts?: MetaBillingSnapshot[];
  error?: string;
}

export interface AdminMetaLiveAggregateResult {
  success: boolean;
  error?: string;
  date_from: string | null;
  date_to: string | null;
  totals: {
    campaigns_with_metrics: number;
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    results: number;
    /** Soma do `spend_brl` deduplicado por (integration_id, campaign_id). Sempre em BRL. */
    spend: number;
    /** Idem, restrito a campanhas marcadas como bolão no CRM. Em BRL. */
    spend_bolao: number;
    /** Soma de resultados (ações Meta) em campanhas tipo normal / bolão. */
    results_normal: number;
    results_bolao: number;
  };
  billing: MetaBillingSummary;
  /** Cotações usadas para converter spend não-BRL nas linhas/totais (ex.: USD→BRL). */
  exchange_rates: ExchangeRateSnapshot[];
  campaigns: AdminMetaLiveCampaignRow[];
  integrations: AdminMetaLiveIntegrationTrace[];
  /**
   * Série diária de gasto em BRL (uma entrada por dia com gasto), agregada das mesmas
   * insights LIVE da Meta (`time_increment=1`) usadas nas campanhas — deduplicada por
   * (integração, campanha) e convertida para BRL com a mesma cotação dos totais.
   * Ordenada por data ascendente. Alimenta o card "Gasto de Ads × Depósito".
   */
  daily_spend: Array<{ date: string; spend_brl: number }>;
}

export async function listAdminMetaLiveJobs(includeInactiveIntegrations = false): Promise<AdminMetaLiveJob[]> {
  const jobs: AdminMetaLiveJob[] = [];
  const bancasCoveredByShared = new Set<string>();

  let cfgQuery = supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .not('access_token_encrypted', 'is', null);
  if (!includeInactiveIntegrations) {
    cfgQuery = cfgQuery.eq('is_active', true);
  }
  const { data: configs, error: cfgErr } = await cfgQuery;
  if (cfgErr) {
    logMetaReturn('listAdminMetaLiveJobs configs', { error: cfgErr.message });
  }

  for (const row of configs ?? []) {
    const integrationId = String((row as { id: string }).id);
    const linked = await listBancasByIntegration(integrationId);
    if (linked.length === 0) continue;
    for (const b of linked) bancasCoveredByShared.add(b);
    jobs.push({
      kind: 'shared',
      integrationId,
      representativeBancaId: linked[0],
      linkedBancaIds: linked,
    });
  }

  const { data: legacies, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .select('banca_id')
    .eq('is_active', true)
    .not('access_token_encrypted', 'is', null);
  if (legErr) {
    logMetaReturn('listAdminMetaLiveJobs legacies', { error: legErr.message });
  }

  for (const row of legacies ?? []) {
    const bid = String((row as { banca_id: string }).banca_id);
    if (bancasCoveredByShared.has(bid)) continue;
    jobs.push({ kind: 'legacy', representativeBancaId: bid, linkedBancaIds: [bid] });
  }

  const sharedJobs = jobs.filter((j) => j.kind === 'shared');
  const legacyJobs = jobs.filter((j) => j.kind === 'legacy');
  const totalSharedBancas = sharedJobs.reduce((sum, j) => sum + j.linkedBancaIds.length, 0);
  logMetaReturn('listAdminMetaLiveJobs ← deduplicação por integração', {
    include_inactive_integrations: includeInactiveIntegrations,
    integrations_total: jobs.length,
    shared_integrations: sharedJobs.length,
    bancas_cobertas_shared: totalSharedBancas,
    legacy_integrations: legacyJobs.length,
    deduplicacao_eficiencia: sharedJobs.length > 0
      ? `${sharedJobs.length} chamada(s) cobrem ${totalSharedBancas} banca(s)`
      : 'sem integrações compartilhadas',
  });

  return jobs;
}

export type ConsolidateAllActiveCampaignsSpendOptions = GetActiveCampaignsSpendOptions & {
  /** Quando true, inclui linhas inativas em `meta_integration_configs`. */
  includeInactiveIntegrations?: boolean;
  /**
   * Quando true, PULA o billing (getAccountFinance + getAdAccountBillingCharges) por integração.
   * Chamadores que só precisam do spend (ex.: ranking Banca×Ads) evitam essas chamadas Meta lentas.
   * O `billing` retornado fica vazio.
   */
  skipBilling?: boolean;
};

/** Campanha ativa (insights) + origem multi-tenant. */
export type ConsolidatedActiveCampaignSpendEntry = ActiveCampaignSpendRow & {
  integration_id: string;
  source: 'shared' | 'legacy';
  ad_account_id: string;
  banca_ids: string[];
};

export type ConsolidatedActiveCampaignsSpendIntegrationSlice = {
  integration_id: string;
  source: 'shared' | 'legacy';
  ad_account_id: string | null;
  banca_ids: string[];
  total_spend: number;
  billing: MetaBillingSnapshot | null;
  campaigns: ActiveCampaignSpendRow[];
  error?: string;
};

export type ConsolidatedActiveCampaignsSpendAllResult = {
  campaigns: ConsolidatedActiveCampaignSpendEntry[];
  by_integration: ConsolidatedActiveCampaignsSpendIntegrationSlice[];
  summary: {
    integrations_total: number;
    integrations_ok: number;
    integrations_failed: number;
    campaigns_total: number;
    total_spend: number;
    billing_total_balance_due: number;
    billing_total_amount_spent: number;
    /** Soma das cobranças no cartão (deduplicada por ad_account_id), no mesmo período do filtro. */
    billing_total_card_charges: number;
    /** Quantidade de cobranças. */
    billing_card_charges_count: number;
  };
  billing: MetaBillingSummary;
};

/**
 * Percorre todas as integrações Meta com token (modelo compartilhado + legado sem vínculo duplicado),
 * busca insights de campanhas com entrega ativa por conta e consolida em uma resposta.
 * Chamadas Graph são **sequenciais** para reduzir risco de rate limit.
 */
export async function consolidateActiveCampaignsSpendAllIntegrations(
  options?: ConsolidateAllActiveCampaignsSpendOptions
): Promise<ConsolidatedActiveCampaignsSpendAllResult> {
  const { includeInactiveIntegrations, skipBilling, ...spendOpts } = options ?? {};
  const jobs = await listAdminMetaLiveJobs(includeInactiveIntegrations === true);
  const by_integration: ConsolidatedActiveCampaignsSpendIntegrationSlice[] = [];
  const campaignsFlat: ConsolidatedActiveCampaignSpendEntry[] = [];
  const billingSnapshots: MetaBillingSnapshot[] = [];

  /**
   * Cada job (token/conta distintos) é independente → roda em pool limitado
   * (META_AGG_CONCURRENCY). `mapWithConcurrency` preserva a ordem, então `by_integration`
   * e `campaignsFlat` mantêm a mesma sequência da versão serial.
   */
  const perJob = await mapWithConcurrency(jobs, META_AGG_CONCURRENCY, async (job) => {
    const banca_ids = job.linkedBancaIds;
    let integration_id = '';
    const source: 'shared' | 'legacy' = job.kind === 'shared' ? 'shared' : 'legacy';
    let baseUrl = DEFAULT_BASE_URL;
    let adAccountId: string | null = null;
    let token: string | null = null;

    if (job.kind === 'shared') {
      integration_id = job.integrationId;
      token = await getDecryptedTokenByIntegrationId(integration_id);
      const { data } = await supabaseServiceRole
        .from('meta_integration_configs')
        .select('base_url, ad_account_id')
        .eq('id', integration_id)
        .maybeSingle();
      baseUrl = String(data?.base_url ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
      adAccountId = data?.ad_account_id != null ? String(data.ad_account_id).trim() : null;
    } else {
      token = await getLegacyDecryptedToken(job.representativeBancaId);
      const { data } = await supabaseServiceRole
        .from('meta_integrations')
        .select('id, base_url, ad_account_id')
        .eq('banca_id', job.representativeBancaId)
        .maybeSingle();
      integration_id = data?.id != null ? String(data.id) : `legacy:${job.representativeBancaId}`;
      baseUrl = String(data?.base_url ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
      adAccountId = data?.ad_account_id != null ? String(data.ad_account_id).trim() : null;
    }

    if (!token || !adAccountId) {
      const slice: ConsolidatedActiveCampaignsSpendIntegrationSlice = {
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: 0,
        billing: null,
        campaigns: [],
        error: !token ? 'Token indisponível.' : 'ad_account_id não configurado.',
      };
      return { slice, billing: null as MetaBillingSnapshot | null, campaigns: [] as ConsolidatedActiveCampaignSpendEntry[] };
    }

    /**
     * Billing (getAccountFinance + getAdAccountBillingCharges) é caro e nem todo chamador usa.
     * Com `skipBilling` (ex.: ranking), pulamos essas chamadas Meta e mantemos só o spend.
     */
    let billing: MetaBillingSnapshot | null = null;
    if (!skipBilling) {
      const cardChargesPeriod = spendOpts?.timeRange?.since && spendOpts?.timeRange?.until
        ? { since: spendOpts.timeRange.since, until: spendOpts.timeRange.until }
        : null;
      const integrationCurrencyHint = await getMetaCurrencyForBanca(banca_ids[0] ?? job.representativeBancaId).catch(
        () => null as string | null
      );
      billing = await fetchMetaBillingSnapshot(baseUrl, token, adAccountId, {
        cardChargesPeriod,
        integrationCurrencyHint,
      });
    }

    try {
      const { campaigns, totalSpend } = await getActiveCampaignsSpend(baseUrl, token, adAccountId, spendOpts);
      const slice: ConsolidatedActiveCampaignsSpendIntegrationSlice = {
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: totalSpend,
        billing,
        campaigns,
      };
      const flat: ConsolidatedActiveCampaignSpendEntry[] = campaigns.map((c) => ({
        ...c,
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids: [...banca_ids],
      }));
      return { slice, billing, campaigns: flat };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const slice: ConsolidatedActiveCampaignsSpendIntegrationSlice = {
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: 0,
        billing,
        campaigns: [],
        error: msg,
      };
      return { slice, billing, campaigns: [] as ConsolidatedActiveCampaignSpendEntry[] };
    }
  });

  for (const { slice, billing, campaigns } of perJob) {
    by_integration.push(slice);
    if (billing) billingSnapshots.push(billing);
    campaignsFlat.push(...campaigns);
  }

  const integrations_ok = by_integration.filter((s) => !s.error).length;
  const integrations_failed = by_integration.filter((s) => Boolean(s.error)).length;
  const total_spend = by_integration.reduce((s, x) => s + x.total_spend, 0);
  const { rates: exchangeRatesToBrlForBilling } = await resolveExchangeRatesForCurrencies(['USD']);
  const billing = summarizeMetaBillingSnapshots(billingSnapshots, { exchangeRatesToBrl: exchangeRatesToBrlForBilling });

  return {
    campaigns: campaignsFlat,
    by_integration,
    summary: {
      integrations_total: jobs.length,
      integrations_ok,
      integrations_failed,
      campaigns_total: campaignsFlat.length,
      total_spend,
      billing_total_balance_due: billing.total_balance_due,
      billing_total_amount_spent: billing.total_amount_spent,
      billing_total_card_charges: billing.total_card_charges,
      billing_card_charges_count: billing.card_charges_count,
    },
    billing,
  };
}

/**
 * Lista jobs só para integrações que têm vínculo em `meta_integration_bancas` com alguma das bancas pedidas.
 * Garante que, com duas (ou mais) integrações na mesma banca, todas entram no live aggregate (scan global por configs pode falhar em edge cases / ordem).
 */
async function listAdminMetaLiveJobsForBancaScope(
  bancaIds: string[],
  includeInactiveIntegrations: boolean
): Promise<AdminMetaLiveJob[]> {
  const scope = Array.from(new Set(bancaIds.map((s) => String(s).trim()).filter(Boolean)));
  if (scope.length === 0) return [];

  const { data: links, error: linkErr } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id')
    .in('banca_id', scope);
  if (linkErr) {
    logMetaReturn('listAdminMetaLiveJobsForBancaScope links', { error: linkErr.message });
    return [];
  }

  const integrationIds = Array.from(
    new Set((links ?? []).map((r: { integration_id: string }) => String(r.integration_id)).filter(Boolean))
  );

  const jobs: AdminMetaLiveJob[] = [];
  const bancasCoveredByShared = new Set<string>();

  for (const integrationId of integrationIds) {
    let cfgQuery = supabaseServiceRole
      .from('meta_integration_configs')
      .select('id')
      .eq('id', integrationId)
      .not('access_token_encrypted', 'is', null);
    if (!includeInactiveIntegrations) {
      cfgQuery = cfgQuery.eq('is_active', true);
    }
    const { data: cfg, error: cfgErr } = await cfgQuery.maybeSingle();
    if (cfgErr || !cfg) continue;

    const linked = await listBancasByIntegration(integrationId);
    if (linked.length === 0) continue;
    if (!linked.some((b) => scope.includes(b))) continue;

    for (const b of linked) bancasCoveredByShared.add(b);
    const rep = scope.find((b) => linked.includes(b)) ?? linked[0];
    jobs.push({
      kind: 'shared',
      integrationId,
      representativeBancaId: rep,
      linkedBancaIds: linked,
    });
  }

  const { data: legacies, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .select('banca_id')
    .eq('is_active', true)
    .not('access_token_encrypted', 'is', null);
  if (legErr) {
    logMetaReturn('listAdminMetaLiveJobsForBancaScope legacies', { error: legErr.message });
  }
  for (const row of legacies ?? []) {
    const bid = String((row as { banca_id: string }).banca_id);
    if (!scope.includes(bid) || bancasCoveredByShared.has(bid)) continue;
    jobs.push({ kind: 'legacy', representativeBancaId: bid, linkedBancaIds: [bid] });
    bancasCoveredByShared.add(bid);
  }

  return jobs;
}

function normalizeScopeBancaIdsForAggregate(ids: string[]): string[] {
  return Array.from(new Set(ids.map((s) => String(s ?? '').trim()).filter(Boolean)));
}

/** Monta a lista de jobs do painel admin live: por escopo de banca(s) ou todas. */
async function resolveAdminMetaLiveJobsForAggregate(
  scopeBancaIds: string[],
  overviewBancaId: string | null
): Promise<AdminMetaLiveJob[]> {
  const scopeNorm = normalizeScopeBancaIdsForAggregate(scopeBancaIds);
  const overview = overviewBancaId?.trim() || null;
  const bancasParaBusca = scopeNorm.length > 0 ? scopeNorm : overview ? [overview] : [];

  let allJobs: AdminMetaLiveJob[];
  if (bancasParaBusca.length > 0) {
    allJobs = await listAdminMetaLiveJobsForBancaScope(bancasParaBusca, true);
  } else {
    allJobs = await listAdminMetaLiveJobs(true);
  }

  const filtered = allJobs.filter((j) => jobMatchesScope(j, scopeNorm, overview));

  const sharedIds = filtered
    .filter((j): j is AdminMetaLiveJob & { kind: 'shared' } => j.kind === 'shared')
    .map((j) => j.integrationId);

  logMetaReturn('resolveAdminMetaLiveJobsForAggregate', {
    bancas_buscadas: bancasParaBusca,
    overview_banca_id: overview,
    candidatos: allJobs.length,
    jobs_finais: filtered.length,
    integration_ids_shared: sharedIds,
  });

  return filtered;
}

function jobMatchesScope(job: AdminMetaLiveJob, scopeBancaIds: string[], overviewBancaId: string | null): boolean {
  const linked = new Set(job.linkedBancaIds);
  if (overviewBancaId && !linked.has(overviewBancaId)) return false;
  if (scopeBancaIds.length === 0) return true;
  return job.linkedBancaIds.some((id) => scopeBancaIds.includes(id));
}

function resolveCampaignOwnerBancaId(
  job: AdminMetaLiveJob,
  campaignId: string,
  ownerByCampaign: Map<string, string>
): string | null {
  const owned = ownerByCampaign.get(String(campaignId));
  if (owned) return owned;
  if (job.linkedBancaIds.length === 1) return job.linkedBancaIds[0];
  return null;
}

export type AdminMetaLiveJobProcessContext = {
  datePreset: string;
  timeRangeUtc: { since: string; until: string };
  preferTimeRangeFirst: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  overviewBancaId: string | null;
  scopeBancaIds: string[];
  activeOnly: boolean;
  /**
   * Mapa moeda → fator para BRL (ex.: { BRL: 1, USD: 5.43 }).
   * Usado para preencher `spend_brl` em cada linha consolidada.
   * Quando vazio/ausente, a função busca a cotação USD-BRL on-demand uma única vez.
   */
  exchangeRatesToBrl?: Record<string, number>;
  /** Quando true, pula o billing por integração (getAccountFinance + activities). Chamadores que só precisam de spend/insights. */
  skipBilling?: boolean;
};

function computeAdminMetaTotalsFromCampaignRows(rows: AdminMetaLiveCampaignRow[]): AdminMetaLiveAggregateResult['totals'] {
  /**
   * Deduplica por (integration_id, campaign_id) antes de somar para que campanhas replicadas
   * em múltiplas bancas vinculadas (modo "Todas as bancas") não inflem os totais.
   * Linhas sem campaign_id são preservadas individualmente.
   */
  const seen = new Set<string>();
  const uniqueRows: AdminMetaLiveCampaignRow[] = [];
  for (const row of rows) {
    const cid = String(row.campaign_id ?? '').trim();
    if (!cid) {
      uniqueRows.push(row);
      continue;
    }
    const integrationKey = row.integration_id != null ? String(row.integration_id) : 'legacy';
    const dedupKey = `${integrationKey}:${cid}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    uniqueRows.push(row);
  }
  return uniqueRows.reduce(
    (acc, row) => {
      acc.campaigns_with_metrics += 1;
      acc.reach += row.reach;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.leads += row.leads;
      acc.results += row.results;
      /**
       * Totais consolidados em BRL: usamos `spend_brl` para evitar somar moedas distintas.
       * Linhas em BRL têm `spend_brl == spend`; em USD são convertidas via cotação atual.
       */
      const spendBrl = Number.isFinite(row.spend_brl) ? row.spend_brl : row.spend;
      acc.spend += spendBrl;
      if (row.campaign_kind === 'bolao') {
        acc.spend_bolao += spendBrl;
        acc.results_bolao += row.results;
      } else {
        acc.results_normal += row.results;
      }
      return acc;
    },
    {
      campaigns_with_metrics: 0,
      reach: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      results: 0,
      spend: 0,
      spend_bolao: 0,
      results_normal: 0,
      results_bolao: 0,
    }
  );
}

function emptyMetaBillingSummary(): MetaBillingSummary {
  return summarizeMetaBillingSnapshots([]);
}

async function enrichAdminMetaCampaignRowsWithBancaNames(rows: AdminMetaLiveCampaignRow[]): Promise<void> {
  const bancaIds = Array.from(new Set(rows.map((r) => r.banca_id)));
  if (bancaIds.length === 0) return;
  const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id,name,url').in('id', bancaIds);
  const bancaById = new Map<string, CrmBancaLite>(
    (bancas ?? []).map((b: { id: string; name: string | null; url: string | null }) => [b.id, b])
  );
  let gestorByBanca = new Map<string, GestorDisplayForCampaign>();
  try {
    gestorByBanca = await resolvePrimaryGestorDisplayByCrmBancaIds(bancaIds);
  } catch (err: unknown) {
    logMetaReturn('enrichAdminMetaCampaignRowsWithBancaNames gestor_user_bancas', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  for (const row of rows) {
    const b = bancaById.get(row.banca_id);
    row.banca_name = b?.name ?? b?.url ?? row.banca_id;
    row.banca_url = b?.url ?? null;
    const g = gestorByBanca.get(row.banca_id) ?? { gestor_names: [], gestor_user_ids: [] };
    row.gestor_names = g.gestor_names;
    row.gestor_user_ids = g.gestor_user_ids;
  }
}

type AdminMetaLiveJobResult = {
  traces: AdminMetaLiveIntegrationTrace[];
  rows: AdminMetaLiveCampaignRow[];
  billingSnapshots: MetaBillingSnapshot[];
  /** Gasto BRL por dia (YYYY-MM-DD) desta integração. */
  spendBrlByDay: Map<string, number>;
};

/**
 * Uma integração Meta (job) → linhas de campanha + trace. Usado em paralelo (aggregate) ou em série (stream).
 */
async function processAdminMetaLiveJob(
  job: AdminMetaLiveJob,
  ctx: AdminMetaLiveJobProcessContext
): Promise<AdminMetaLiveJobResult> {
  const traces: AdminMetaLiveIntegrationTrace[] = [];
  const campaignRows: AdminMetaLiveCampaignRow[] = [];
  const billingSnapshots: MetaBillingSnapshot[] = [];
  /** Gasto BRL por dia (YYYY-MM-DD) desta job; deduplicado por campanha dentro da integração. */
  const spendBrlByDay = new Map<string, number>();
  const {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
  } = ctx;

  const integrationId = job.kind === 'shared' ? job.integrationId : null;
  const rep = job.representativeBancaId;
  const token =
    integrationId != null ? await getDecryptedTokenByIntegrationId(integrationId) : await getDecryptedToken(rep);
  if (!token) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: 'Token não configurado.',
    });
    return { traces, rows: campaignRows, billingSnapshots, spendBrlByDay };
  }

  const { baseUrl, adAccountId: configuredAdAccountIdRaw, blockedAdAccountIds: configuredBlockedRaw } =
    integrationId != null
      ? await resolveMetaApiContextByIntegrationId(integrationId)
      : await resolveMetaApiContext(rep);

  const configuredIds = parseConfiguredAdAccountIds(configuredAdAccountIdRaw ?? undefined, configuredBlockedRaw);

  let candidateAccountIds: string[] = [...configuredIds];
  if (candidateAccountIds.length === 0) {
    try {
      const fromToken = await getAdAccounts(baseUrl, token);
      candidateAccountIds.push(...fromToken.map((a) => String(a.id)).filter(Boolean));
    } catch {
      /* ignore */
    }
  }
  candidateAccountIds = Array.from(new Set(candidateAccountIds));

  if (candidateAccountIds.length === 0) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: 'Nenhuma conta de anúncio disponível.',
    });
    return { traces, rows: campaignRows, billingSnapshots, spendBrlByDay };
  }

  const allCampaigns: Awaited<ReturnType<typeof listCampaigns>> = [];
  const workingAccountIds: string[] = [];
  const attemptErrors: string[] = [];

  const campaignsPerAccount = await Promise.allSettled(
    candidateAccountIds.map((candidateId) => listCampaigns(baseUrl, token, candidateId))
  );
  campaignsPerAccount.forEach((res, idx) => {
    const candidateId = candidateAccountIds[idx];
    if (res.status === 'fulfilled') {
      allCampaigns.push(...res.value);
      workingAccountIds.push(candidateId);
    } else {
      const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      attemptErrors.push(`${candidateId}: ${msg}`);
    }
  });

  if (workingAccountIds.length === 0) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: `Falha ao listar campanhas: ${attemptErrors.join(' | ')}`,
    });
    return { traces, rows: campaignRows, billingSnapshots, spendBrlByDay };
  }

  const liveCardChargesPeriod = dateFrom && dateTo
    ? { since: dateFrom, until: dateTo }
    : null;
  let integrationCurrencyHint: string | null = null;
  try {
    integrationCurrencyHint = await getMetaCurrencyForBanca(rep);
  } catch {
    integrationCurrencyHint = null;
  }
  billingSnapshots.push(
    ...(await Promise.all(
      workingAccountIds.map((accountId) =>
        fetchMetaBillingSnapshot(baseUrl, token, accountId, {
          cardChargesPeriod: liveCardChargesPeriod,
          integrationCurrencyHint,
          // Com skipBilling (ex.: card daily_spend), pula as `/activities` lentas mas mantém finance/moeda.
          skipCardCharges: ctx.skipBilling === true,
        })
      )
    ))
  );

  /**
   * Mapa ad_account_id → moeda (BRL/USD/...). A moeda da campanha = moeda da Ad Account.
   * Construímos a partir do snapshot financeiro recém-buscado (já normaliza prefixo `act_`).
   */
  const currencyByAccountId = new Map<string, string | null>();
  for (const snap of billingSnapshots) {
    if (snap.ad_account_id) currencyByAccountId.set(snap.ad_account_id, snap.currency ?? null);
  }

  const strictInsightRange =
    preferTimeRangeFirst && dateFrom && dateTo && dateFrom <= dateTo
      ? { from: dateFrom, to: dateTo }
      : undefined;

  const allInsightsResults = await Promise.allSettled(
    workingAccountIds.map((accountId) =>
      fetchCampaignInsightsWithFallbacks(baseUrl, token, accountId, datePreset, timeRangeUtc, {
        preferTimeRangeFirst,
        strictInsightRange,
      })
    )
  );

  let insights: MetaInsight[] = [];
  let sourceLabel = '';
  for (const result of allInsightsResults) {
    if (result.status === 'fulfilled') {
      insights.push(...result.value.insights);
      if (!sourceLabel) sourceLabel = result.value.sourceLabel;
    }
  }
  if (preferTimeRangeFirst && dateFrom && dateTo) {
    insights = filterInsightsByDateStartRange(insights, dateFrom, dateTo);
  }

  const normalizedAdAccountIds = workingAccountIds.map((id) => (id.startsWith('act_') ? id : `act_${id}`));
  const campaigns = allCampaigns;

  const visible = campaigns.filter((c) => {
    if (!activeOnly) return true;
    return c.status === 'ACTIVE' || c.effective_status === 'ACTIVE';
  });
  const visibleIds = new Set(visible.map((c) => String(c.id)));

  /** DEBUG: rastreia filtros aplicados às campanhas listadas — útil pra diagnosticar campanha "sumida". */
  if (isMetaVerboseLogEnabled()) {
    const filteredOutByActiveOnly = campaigns
      .filter((c) => !visibleIds.has(String(c.id)))
      .map((c) => ({
        campaign_id: String(c.id),
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
      }));
    if (filteredOutByActiveOnly.length > 0) {
      metaVerboseLog('[processAdminMetaLiveJob] filtered out by activeOnly', {
        integration_id: integrationId,
        rep_banca_id: rep,
        filtered_count: filteredOutByActiveOnly.length,
        sample: filteredOutByActiveOnly.slice(0, 10),
      });
    }
    metaVerboseLog('[processAdminMetaLiveJob] listCampaigns snapshot', {
      integration_id: integrationId,
      rep_banca_id: rep,
      linked_bancas: job.linkedBancaIds,
      ad_accounts: normalizedAdAccountIds,
      total_listed: campaigns.length,
      visible_after_active_filter: visible.length,
      active_only: activeOnly,
    });
  }

  const fetchedCampaignIds = Array.from(visibleIds);
  const ownerByCampaign = new Map<string, string>();
  const kindByBancaCampaign = new Map<string, 'normal' | 'bolao'>();
  /**
   * Override manual de moeda salvo via UI (POST /api/admin/meta/campaign-currency).
   * Quando presente, ele tem prioridade sobre a moeda devolvida pela Ad Account.
   */
  const currencyOverrideByBancaCampaign = new Map<string, 'BRL' | 'USD'>();
  if (fetchedCampaignIds.length > 0) {
    const { data: existingOwners } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, banca_id, updated_at, campaign_kind, currency_override')
      .in('campaign_id', fetchedCampaignIds)
      .in('banca_id', job.linkedBancaIds)
      .order('updated_at', { ascending: false });
    for (const row of existingOwners ?? []) {
      const campaignId = String((row as { campaign_id: string }).campaign_id);
      const ownerBancaId = String((row as { banca_id: string }).banca_id);
      if (!ownerByCampaign.has(campaignId)) ownerByCampaign.set(campaignId, ownerBancaId);
      const bk = `${ownerBancaId}:${campaignId}`;
      if (!kindByBancaCampaign.has(bk)) {
        const rawKind = (row as { campaign_kind?: string | null }).campaign_kind;
        kindByBancaCampaign.set(bk, String(rawKind || 'normal') === 'bolao' ? 'bolao' : 'normal');
      }
      const rawOverride = (row as { currency_override?: string | null }).currency_override;
      if (rawOverride && !currencyOverrideByBancaCampaign.has(bk)) {
        const upper = String(rawOverride).trim().toUpperCase();
        if (upper === 'BRL' || upper === 'USD') {
          currencyOverrideByBancaCampaign.set(bk, upper);
        }
      }
    }
  }

  const metricsByCampaign = new Map<
    string,
    { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }
  >();

  for (const ins of insights) {
    const cid = ins.campaign_id ? String(ins.campaign_id) : '';
    if (!cid || !visibleIds.has(cid)) continue;
    const cur = metricsByCampaign.get(cid) ?? {
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
    };
    cur.reach += parseInt(ins.reach || '0', 10) || 0;
    cur.impressions += parseInt(ins.impressions || '0', 10) || 0;
    cur.clicks += parseInt(ins.clicks || '0', 10) || 0;
    cur.spend += parseFloat(ins.spend || '0') || 0;
    cur.leads += leadsFromMetaInsightActions(ins.actions);
    cur.results += extractResultsFromInsightActions(ins.actions);
    metricsByCampaign.set(cid, cur);
  }

  /**
   * Gasto diário (moeda da conta) por campanha, das mesmas insights LIVE (`time_increment=1`).
   * Convertido para BRL e somado em `spendBrlByDay` no loop de campanhas visíveis abaixo,
   * uma vez por campanha (dedup por integração) para casar com os totais do painel.
   */
  const dailySpendByCampaign = new Map<string, Map<string, number>>();
  for (const ins of insights) {
    const cid = ins.campaign_id ? String(ins.campaign_id) : '';
    if (!cid || !visibleIds.has(cid)) continue;
    const day = String(ins.date_start ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const spend = parseFloat(ins.spend || '0') || 0;
    if (spend === 0) continue;
    let dm = dailySpendByCampaign.get(cid);
    if (!dm) {
      dm = new Map<string, number>();
      dailySpendByCampaign.set(cid, dm);
    }
    dm.set(day, (dm.get(day) ?? 0) + spend);
  }

  const normalizedAdAccount = normalizedAdAccountIds.join(', ');

  let replicatedCampaignsForMultiBanca = 0;
  /** DEBUG: campanhas ACTIVE listadas mas sem métricas → eliminadas pelo filtro hasMetrics. */
  const droppedByNoMetrics: Array<{ campaign_id: string; name: string | null }> = [];

  for (const c of visible) {
    const cid = String(c.id);
    const m = metricsByCampaign.get(cid) ?? {
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
    };
    const hasMetrics =
      m.reach > 0 ||
      m.impressions > 0 ||
      m.clicks > 0 ||
      m.leads > 0 ||
      m.results > 0 ||
      m.spend > 0;
    if (!hasMetrics) {
      droppedByNoMetrics.push({ campaign_id: cid, name: c.name ?? null });
      continue;
    }

    /**
     * Resolução do destino da campanha:
     * 1. Owner explícito em meta_campaigns (vínculo prévio).
     * 2. Filtro de overview/banca específica selecionado pela UI.
     * 3. Escopo restrito a 1 banca.
     * 4. Integração com 1 só banca vinculada.
     * 5. Modo "Todas as bancas" + integração multi-banca: replica linha em cada banca vinculada
     *    para que a campanha apareça associada a qualquer uma delas no painel.
     *    Os totais (gasto/leads/etc.) são deduplicados por campaign_id em
     *    computeAdminMetaTotalsFromCampaignRows para não serem inflados pela replicação.
     */
    let targetBancaIds: string[] = [];
    const owned = ownerByCampaign.get(cid);
    if (owned) {
      targetBancaIds = [owned];
    } else if (overviewBancaId && job.linkedBancaIds.includes(overviewBancaId)) {
      targetBancaIds = [overviewBancaId];
    } else if (scopeBancaIds.length === 1 && job.linkedBancaIds.includes(scopeBancaIds[0])) {
      targetBancaIds = [scopeBancaIds[0]];
    } else if (job.linkedBancaIds.length === 1) {
      targetBancaIds = [job.linkedBancaIds[0]];
    } else if (scopeBancaIds.length > 0) {
      targetBancaIds = job.linkedBancaIds.filter((id) => scopeBancaIds.includes(id));
    } else {
      targetBancaIds = [...job.linkedBancaIds];
      if (job.linkedBancaIds.length > 1) replicatedCampaignsForMultiBanca += 1;
    }

    targetBancaIds = targetBancaIds.filter((resolvedBancaId) => {
      if (overviewBancaId && resolvedBancaId !== overviewBancaId) return false;
      if (scopeBancaIds.length > 0 && !scopeBancaIds.includes(resolvedBancaId)) return false;
      return true;
    });

    if (targetBancaIds.length === 0) continue;

    /**
     * Resolve a moeda da Ad Account "primária" desta linha (primeira working account dessa job).
     * Quando uma campanha aparece em múltiplas contas, usamos a primeira do `workingAccountIds` como representação.
     * Cada Ad Account tem só uma moeda, então isso casa com a realidade do operacional.
     */
    const primaryAdAccountId = workingAccountIds[0]
      ? workingAccountIds[0].startsWith('act_')
        ? workingAccountIds[0]
        : `act_${workingAccountIds[0]}`
      : null;
    const nativeAccountCurrency =
      (primaryAdAccountId ? currencyByAccountId.get(primaryAdAccountId) : null) ?? null;

    /**
     * Série diária: soma o gasto diário desta campanha (BRL) UMA vez por integração,
     * usando a moeda efetiva da primeira banca de destino (mesma base do row deduplicado
     * em computeAdminMetaTotalsFromCampaignRows). Evita inflar quando a campanha é
     * replicada em múltiplas bancas no modo "Todas as bancas".
     */
    const dailyForCampaign = dailySpendByCampaign.get(cid);
    if (dailyForCampaign) {
      const firstBanca = targetBancaIds[0];
      const dailyOverride = currencyOverrideByBancaCampaign.get(`${firstBanca}:${cid}`) ?? null;
      const dailyCurrency = dailyOverride ?? nativeAccountCurrency;
      for (const [day, daySpend] of dailyForCampaign) {
        const brl =
          convertMetaSpendToBrl(daySpend, dailyCurrency, ctx.exchangeRatesToBrl ?? {}) ?? daySpend;
        spendBrlByDay.set(day, (spendBrlByDay.get(day) ?? 0) + brl);
      }
    }

    for (const resolvedBancaId of targetBancaIds) {
      const kindKey = `${resolvedBancaId}:${cid}`;
      const campaign_kind = kindByBancaCampaign.get(kindKey) ?? 'normal';

      /**
       * Resolve a moeda efetivamente exibida e usada na conversão para BRL:
       *  1. override manual salvo no admin (meta_campaigns.currency_override).
       *  2. moeda nativa da Ad Account devolvida pela Meta.
       *  3. null quando ambas indisponíveis.
       *
       * Quando o override muda a moeda (ex.: Ad Account em BRL marcada como USD),
       * `m.spend` continua sendo o valor bruto devolvido pela Meta nessa Ad Account
       * — o override só altera como interpretamos esse valor para conversão e
       * apresentação. Por isso `spend_brl` é recalculado aqui.
       */
      const overrideCurrency = currencyOverrideByBancaCampaign.get(kindKey) ?? null;
      const effectiveCurrency = overrideCurrency ?? nativeAccountCurrency;
      const rowSpendBrl =
        convertMetaSpendToBrl(m.spend, effectiveCurrency, ctx.exchangeRatesToBrl ?? {}) ?? m.spend;

      campaignRows.push({
        banca_id: resolvedBancaId,
        banca_name: resolvedBancaId,
        banca_url: null,
        campaign_id: cid,
        campaign_kind,
        name: c.name || cid,
        objective: c.objective ?? null,
        status: c.status ?? null,
        effective_status: c.effective_status ?? null,
        daily_budget: normalizeBudget(c.daily_budget ?? null),
        lifetime_budget: normalizeBudget(c.lifetime_budget ?? null),
        start_time: c.start_time ?? null,
        stop_time: c.stop_time ?? null,
        reach: m.reach,
        impressions: m.impressions,
        clicks: m.clicks,
        leads: m.leads,
        results: m.results,
        spend: m.spend,
        currency: effectiveCurrency,
        currency_account: nativeAccountCurrency,
        currency_override: overrideCurrency,
        spend_brl: rowSpendBrl,
        integration_id: integrationId,
        ad_account_id: normalizedAdAccount,
        insights_source: sourceLabel,
      });
    }
  }

  if (replicatedCampaignsForMultiBanca > 0) {
    logMetaReturn('processAdminMetaLiveJob ← replicação por banca (modo Todas as bancas)', {
      integration_id: integrationId,
      representative_banca_id: rep,
      linked_bancas: job.linkedBancaIds.length,
      replicated_campaigns: replicatedCampaignsForMultiBanca,
      observacao:
        'Campanhas sem owner pré-definido em meta_campaigns são replicadas em cada banca vinculada para evitar perdas no painel "Todas as bancas". Totais e cards são deduplicados por campaign_id.',
    });
  }

  if (droppedByNoMetrics.length > 0) {
    metaVerboseLog('[processAdminMetaLiveJob] dropped by hasMetrics=false', {
      integration_id: integrationId,
      rep_banca_id: rep,
      linked_bancas: job.linkedBancaIds,
      dropped_count: droppedByNoMetrics.length,
      sample: droppedByNoMetrics.slice(0, 10),
      observacao:
        'Campanhas ACTIVE listadas em listCampaigns mas sem retorno em fetchCampaignInsightsWithFallbacks. ' +
        'Comum quando o fallback chain (date_preset → time_range) escolhe um período diferente do filtro do usuário.',
    });
  }
  metaVerboseLog('[processAdminMetaLiveJob] resumo', {
    integration_id: integrationId,
    rep_banca_id: rep,
    listed: campaigns.length,
    visible_active: visible.length,
    dropped_no_metrics: droppedByNoMetrics.length,
    final_rows_emitted: campaignRows.length,
    insights_source: sourceLabel,
  });

  traces.push({
    integration_id: integrationId,
    representative_banca_id: rep,
    ad_account_id: normalizedAdAccount,
    insights_source: sourceLabel,
    billing_accounts: billingSnapshots,
  });

  return { traces, rows: campaignRows, billingSnapshots, spendBrlByDay };
}

export type AdminMetaLiveStreamBatchEvent = {
  type: 'batch';
  batchIndex: number;
  totalBatches: number;
  integrations_delta: AdminMetaLiveIntegrationTrace[];
  campaigns_delta: AdminMetaLiveCampaignRow[];
  totals: AdminMetaLiveAggregateResult['totals'];
  billing: MetaBillingSummary;
  exchange_rates: ExchangeRateSnapshot[];
};

export type AdminMetaLiveStreamCompleteEvent = {
  type: 'complete';
  date_from: string | null;
  date_to: string | null;
  totals: AdminMetaLiveAggregateResult['totals'];
  billing: MetaBillingSummary;
  exchange_rates: ExchangeRateSnapshot[];
  campaigns: AdminMetaLiveCampaignRow[];
  integrations: AdminMetaLiveIntegrationTrace[];
  /** Série diária de gasto em BRL — alimenta o card "Gasto de Ads × Depósito" sem rodar a Meta de novo. */
  daily_spend: AdminMetaLiveAggregateResult['daily_spend'];
};

export type AdminMetaLiveStreamErrorEvent = {
  type: 'error';
  error: string;
};

/**
 * Processa integrações em série e emite um lote após cada uma (NDJSON no cliente).
 */
export async function* iterateAdminMetaLiveAggregateStream(opts: {
  dateFrom: string | null;
  dateTo: string | null;
  scopeBancaIds: string[];
  overviewBancaId: string | null;
  activeOnly: boolean;
  datePreset?: string;
}): AsyncGenerator<AdminMetaLiveStreamBatchEvent | AdminMetaLiveStreamCompleteEvent | AdminMetaLiveStreamErrorEvent> {
  const { dateFrom, dateTo, scopeBancaIds, overviewBancaId, activeOnly } = opts;
  const datePreset = (opts.datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  const preferTimeRangeFirst = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const timeRangeUtc =
    dateFrom && dateTo ? { since: dateFrom, until: dateTo } : getTimeRangeSinceUntil(30);

  /**
   * Cotações para conversão BRL nos totais. Pré-busca USD-BRL (caso típico — Ad Accounts em USD).
   * Outras moedas usam taxa neutra (1) e ficam visíveis no log de `resolveExchangeRatesForCurrencies`.
   */
  const { rates: exchangeRatesToBrl, snapshots: exchangeRateSnapshots } =
    await resolveExchangeRatesForCurrencies(['USD']);

  const ctx: AdminMetaLiveJobProcessContext = {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
    exchangeRatesToBrl,
  };

  let allJobs = await resolveAdminMetaLiveJobsForAggregate(scopeBancaIds, overviewBancaId);

  if (allJobs.length === 0) {
    const emptyTotals = computeAdminMetaTotalsFromCampaignRows([]);
    yield {
      type: 'complete',
      date_from: dateFrom,
      date_to: dateTo,
      totals: emptyTotals,
      billing: emptyMetaBillingSummary(),
      exchange_rates: exchangeRateSnapshots,
      campaigns: [],
      integrations: [],
      daily_spend: [],
    };
    return;
  }

  const accumulated: AdminMetaLiveCampaignRow[] = [];
  const integrationTraces: AdminMetaLiveIntegrationTrace[] = [];
  const billingSnapshots: MetaBillingSnapshot[] = [];
  const spendBrlByDay = new Map<string, number>();

  /**
   * Jobs processados em pool de concorrência (META_AGG_CONCURRENCY): cada um emite seu
   * `batch` assim que termina (ordem de conclusão, não de entrada). A acumulação e o
   * cálculo dos totais/billing acontecem aqui, no consumidor serial do gerador, então os
   * `totals` permanecem cumulativos e consistentes mesmo com conclusão fora de ordem.
   * O worker captura erros e os devolve como resultado (nunca rejeita).
   */
  type JobOutcome =
    | { ok: true; traces: AdminMetaLiveIntegrationTrace[]; rows: AdminMetaLiveCampaignRow[]; billingSnapshots: MetaBillingSnapshot[]; spendBrlByDay: Map<string, number> }
    | { ok: false; error: string };

  let completed = 0;
  const stream = streamWithConcurrency<AdminMetaLiveJob, JobOutcome>(
    allJobs,
    META_AGG_CONCURRENCY,
    async (job): Promise<JobOutcome> => {
      try {
        const r = await processAdminMetaLiveJob(job, ctx);
        return { ok: true, ...r };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logMetaReturn('iterateAdminMetaLiveAggregateStream job error', { error: msg });
        return { ok: false, error: msg };
      }
    }
  );

  for await (const outcome of stream) {
    if (!outcome.ok) {
      completed++;
      yield { type: 'error', error: outcome.error };
      continue;
    }
    const { traces, rows, billingSnapshots: jobBillingSnapshots } = outcome;
    integrationTraces.push(...traces);
    accumulated.push(...rows);
    billingSnapshots.push(...jobBillingSnapshots);
    for (const [day, brl] of outcome.spendBrlByDay) {
      spendBrlByDay.set(day, (spendBrlByDay.get(day) ?? 0) + brl);
    }
    await enrichAdminMetaCampaignRowsWithBancaNames(rows);
    const totals = computeAdminMetaTotalsFromCampaignRows(accumulated);
    const billing = summarizeMetaBillingSnapshots(billingSnapshots, { exchangeRatesToBrl });
    yield {
      type: 'batch',
      batchIndex: completed,
      totalBatches: allJobs.length,
      integrations_delta: traces,
      campaigns_delta: rows,
      totals,
      billing,
      exchange_rates: exchangeRateSnapshots,
    };
    completed++;
  }

  accumulated.sort((a, b) => b.spend_brl - a.spend_brl);
  const totals = computeAdminMetaTotalsFromCampaignRows(accumulated);
  const billing = summarizeMetaBillingSnapshots(billingSnapshots, { exchangeRatesToBrl });
  const daily_spend = Array.from(spendBrlByDay.entries())
    .map(([date, spend_brl]) => ({ date, spend_brl: Math.round(spend_brl * 100) / 100 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  yield {
    type: 'complete',
    date_from: dateFrom,
    date_to: dateTo,
    totals,
    billing,
    exchange_rates: exchangeRateSnapshots,
    campaigns: accumulated,
    integrations: integrationTraces,
    daily_spend,
  };
}

/**
 * Painel Admin Meta: mesma estratégia de insights que runSync (`fetchCampaignInsightsWithFallbacks`),
 * em todas as integrações ativas, com nomes de campanha vindos do Graph e métricas somadas no intervalo
 * (série diária da Meta, `time_increment=1`). Respeita filtro de bancas e período da UI.
 */
export async function fetchAdminMetaLiveAggregate(opts: {
  dateFrom: string | null;
  dateTo: string | null;
  scopeBancaIds: string[];
  overviewBancaId: string | null;
  activeOnly: boolean;
  datePreset?: string;
  /** Pula as `/activities` (cobranças no cartão) — chamadores que só usam spend/daily_spend. */
  skipBilling?: boolean;
}): Promise<AdminMetaLiveAggregateResult> {
  const { dateFrom, dateTo, scopeBancaIds, overviewBancaId, activeOnly } = opts;
  const datePreset = (opts.datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  /** Com início/fim na UI, não priorizar last_30d (senão soma 30 dias ignorando o filtro). */
  const preferTimeRangeFirst = Boolean(dateFrom && dateTo && dateFrom <= dateTo);

  const timeRangeUtc =
    dateFrom && dateTo
      ? { since: dateFrom, until: dateTo }
      : getTimeRangeSinceUntil(30);

  const { rates: exchangeRatesToBrl, snapshots: exchangeRateSnapshots } =
    await resolveExchangeRatesForCurrencies(['USD']);

  let allJobs = await resolveAdminMetaLiveJobsForAggregate(scopeBancaIds, overviewBancaId);
  if (allJobs.length === 0) {
    return {
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      totals: {
        campaigns_with_metrics: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        results: 0,
        spend: 0,
        spend_bolao: 0,
        results_normal: 0,
        results_bolao: 0,
      },
      billing: emptyMetaBillingSummary(),
      exchange_rates: exchangeRateSnapshots,
      campaigns: [],
      integrations: [],
      daily_spend: [],
    };
  }

  const integrationTraces: AdminMetaLiveIntegrationTrace[] = [];
  const campaignRows: AdminMetaLiveCampaignRow[] = [];
  const billingSnapshots: MetaBillingSnapshot[] = [];
  const spendBrlByDay = new Map<string, number>();

  const jobCtx: AdminMetaLiveJobProcessContext = {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
    exchangeRatesToBrl,
    skipBilling: opts.skipBilling === true,
  };

  /** Pool limitado (META_AGG_CONCURRENCY) em vez de disparar todos os jobs de uma vez,
   *  evitando estourar o rate limit da Graph API e o backoff em cascata no metaClient. */
  const settled = await mapWithConcurrency(allJobs, META_AGG_CONCURRENCY, async (job) => {
    try {
      return { status: 'fulfilled' as const, value: await processAdminMetaLiveJob(job, jobCtx) };
    } catch (reason: unknown) {
      return { status: 'rejected' as const, reason };
    }
  });

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      integrationTraces.push(...r.value.traces);
      campaignRows.push(...r.value.rows);
      billingSnapshots.push(...r.value.billingSnapshots);
      for (const [day, brl] of r.value.spendBrlByDay) {
        spendBrlByDay.set(day, (spendBrlByDay.get(day) ?? 0) + brl);
      }
    } else {
      logMetaReturn('fetchAdminMetaLiveAggregate job rejected', {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  await enrichAdminMetaCampaignRowsWithBancaNames(campaignRows);

  campaignRows.sort((a, b) => b.spend_brl - a.spend_brl);

  const totals = computeAdminMetaTotalsFromCampaignRows(campaignRows);
  const billing = summarizeMetaBillingSnapshots(billingSnapshots, { exchangeRatesToBrl });
  const daily_spend = Array.from(spendBrlByDay.entries())
    .map(([date, spend_brl]) => ({ date, spend_brl: Math.round(spend_brl * 100) / 100 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    success: true,
    date_from: dateFrom,
    date_to: dateTo,
    totals,
    billing,
    exchange_rates: exchangeRateSnapshots,
    campaigns: campaignRows,
    integrations: integrationTraces,
    daily_spend,
  };
}

/**
 * Reatribui uma campanha (e seus dados sincronizados) para outra banca
 * dentro do mesmo vínculo de integração compartilhada.
 */
async function findSharedIntegrationContainingBancas(
  sourceBancaId: string,
  targetBancaId: string
): Promise<string | null> {
  for (const iid of await listIntegrationIdsByBanca(sourceBancaId)) {
    const linked = new Set(await listBancasByIntegration(iid));
    if (linked.has(sourceBancaId) && linked.has(targetBancaId)) return iid;
  }
  return null;
}

export async function assignCampaignToBanca(
  contextBancaId: string,
  sourceBancaId: string,
  targetBancaId: string,
  campaignId: string
): Promise<{ success: boolean; moved?: { campaigns: number; adsets: number; insights: number }; error?: string }> {
  const integrationId =
    (await findSharedIntegrationContainingBancas(sourceBancaId, targetBancaId)) ??
    (await resolveIntegrationIdByBanca(contextBancaId));
  if (!integrationId) {
    return { success: false, error: 'Integração Meta não encontrada para a banca informada.' };
  }

  const linkedBancas = await listBancasByIntegration(integrationId);
  const linkedSet = new Set(linkedBancas);
  if (!linkedSet.has(sourceBancaId) || !linkedSet.has(targetBancaId)) {
    return { success: false, error: 'A banca de origem/destino não pertence à mesma integração.' };
  }
  if (!campaignId) {
    return { success: false, error: 'campaign_id é obrigatório.' };
  }
  if (sourceBancaId === targetBancaId) {
    return { success: true, moved: { campaigns: 0, adsets: 0, insights: 0 } };
  }

  const now = new Date().toISOString();
  try {
    // Evita conflito de chave única no destino quando já existir a mesma campanha.
    await supabaseServiceRole
      .from('meta_campaigns')
      .delete()
      .eq('banca_id', targetBancaId)
      .eq('campaign_id', campaignId);

    await supabaseServiceRole
      .from('meta_insights_daily')
      .delete()
      .eq('banca_id', targetBancaId)
      .eq('campaign_id', campaignId);

    const { data: movedCampaigns, error: campaignErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('campaign_id');
    if (campaignErr) return { success: false, error: campaignErr.message };

    /**
     * Se a campanha ainda não foi sincronizada na origem (UPDATE afetou 0 linhas),
     * cria linha mínima no destino — sem isso o ranking não respeita o vínculo manual.
     */
    let createdCampaignRow = false;
    if ((movedCampaigns?.length ?? 0) === 0) {
      const { error: insertErr } = await supabaseServiceRole
        .from('meta_campaigns')
        .insert({
          banca_id: targetBancaId,
          campaign_id: campaignId,
          name: null,
          campaign_kind: 'normal',
          updated_at: now,
        });
      if (insertErr && !/duplicate key|unique/i.test(insertErr.message || '')) {
        return { success: false, error: insertErr.message };
      }
      if (!insertErr) createdCampaignRow = true;
    }

    const { data: movedAdsets, error: adsetErr } = await supabaseServiceRole
      .from('meta_adsets')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('adset_id');
    if (adsetErr) return { success: false, error: adsetErr.message };

    const { data: movedInsights, error: insightErr } = await supabaseServiceRole
      .from('meta_insights_daily')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('date');
    if (insightErr) return { success: false, error: insightErr.message };

    return {
      success: true,
      moved: {
        campaigns: (movedCampaigns?.length ?? 0) + (createdCampaignRow ? 1 : 0),
        adsets: movedAdsets?.length ?? 0,
        insights: movedInsights?.length ?? 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao reatribuir campanha.' };
  }
}

/**
 * Sincroniza uma integração específica (ou legado quando integrationIdForConfig é null).
 */
async function runSyncSingle(
  bancaId: string,
  integrationIdForConfig: string | null,
  datePreset: string
): Promise<{
  success: boolean;
  campaignsCount?: number;
  adsetsCount?: number;
  insightsCount?: number;
  error?: string;
}> {
  let token: string | null = null;
  let baseUrl = DEFAULT_BASE_URL;
  let adAccountIdRaw: string | null = null;
  let blockedAdAccountIdsRaw: string | null = null;

  if (integrationIdForConfig) {
    token = await getDecryptedTokenByIntegrationId(integrationIdForConfig);
    const ctx = await resolveMetaApiContextByIntegrationId(integrationIdForConfig);
    baseUrl = ctx.baseUrl;
    adAccountIdRaw = ctx.adAccountId;
    blockedAdAccountIdsRaw = ctx.blockedAdAccountIds;
  } else {
    token = await getLegacyDecryptedToken(bancaId);
    const { data: leg } = await supabaseServiceRole
      .from('meta_integrations')
      .select('base_url, ad_account_id, blocked_ad_account_ids')
      .eq('banca_id', bancaId)
      .maybeSingle();
    baseUrl = (leg?.base_url as string) || DEFAULT_BASE_URL;
    adAccountIdRaw = (leg?.ad_account_id as string) || null;
    blockedAdAccountIdsRaw = (leg?.blocked_ad_account_ids as string | null) ?? null;
  }

  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const configuredExplicit = parseConfiguredAdAccountIds(adAccountIdRaw ?? undefined, blockedAdAccountIdsRaw);

  let campaignsCount = 0;
  let adsetsCount = 0;
  let insightsCount = 0;

  // Referência UTC para fallback; insights usam principalmente date_preset (fuso da conta na Meta).
  const timeRange = getTimeRangeSinceUntil(30);

  try {
    let candidateAccountIds: string[] = [];
    if (configuredExplicit.length > 0) {
      candidateAccountIds = configuredExplicit;
    } else {
      try {
        const fromToken = await getAdAccounts(baseUrl, token);
        candidateAccountIds = Array.from(
          new Set(fromToken.map((a) => String(a.id)).filter(Boolean))
        );
      } catch {
        /* sem contas via token */
      }
    }
    if (candidateAccountIds.length === 0) {
      return {
        success: false,
        error: 'Ad Account ID não configurado e nenhuma conta de anúncio disponível no token.',
      };
    }

    let adAccountId = candidateAccountIds[0];
    let campaigns: Awaited<ReturnType<typeof listCampaigns>> | null = null;
    let adsets: Awaited<ReturnType<typeof listAdSets>> | null = null;
    let accountFinance: Awaited<ReturnType<typeof getAccountFinance>> | null = null;
    const attemptErrors: string[] = [];

    for (const candidateId of candidateAccountIds) {
      try {
        const [c, a, f] = await Promise.all([
          listCampaigns(baseUrl, token, candidateId),
          listAdSets(baseUrl, token, candidateId),
          getAccountFinance(baseUrl, token, candidateId).catch(() => null),
        ]);
        adAccountId = candidateId;
        campaigns = c;
        adsets = a;
        accountFinance = f;
        break;
      } catch (err: any) {
        const msg = err?.message || String(err);
        attemptErrors.push(`${candidateId}: ${msg}`);
      }
    }

    if (!campaigns || !adsets) {
      return {
        success: false,
        error: `Nenhuma conta de anúncio permitiu sincronizar. Tentativas: ${attemptErrors.join(' | ')}`,
      };
    }

    const { insights, sourceLabel: insightsSourceLabel } = await fetchCampaignInsightsWithFallbacks(
      baseUrl,
      token,
      adAccountId,
      datePreset,
      timeRange
    );

    const linkedBancas = integrationIdForConfig
      ? await listBancasByIntegration(integrationIdForConfig)
      : [bancaId];
    const scopeBancas = linkedBancas.length > 0 ? linkedBancas : [bancaId];
    const fetchedCampaignIds = Array.from(new Set(campaigns.map((c) => String(c.id)).filter(Boolean)));
    const ownerByCampaign = new Map<string, string>();
    if (fetchedCampaignIds.length > 0) {
      const { data: existingOwners } = await supabaseServiceRole
        .from('meta_campaigns')
        .select('campaign_id, banca_id, updated_at')
        .in('campaign_id', fetchedCampaignIds)
        .in('banca_id', scopeBancas)
        .order('updated_at', { ascending: false });
      for (const row of existingOwners ?? []) {
        const campaignId = String((row as { campaign_id: string }).campaign_id);
        const ownerBancaId = String((row as { banca_id: string }).banca_id);
        if (!ownerByCampaign.has(campaignId)) ownerByCampaign.set(campaignId, ownerBancaId);
      }
    }
    const resolveCampaignOwner = (campaignId: string | null | undefined): string =>
      (campaignId ? ownerByCampaign.get(String(campaignId)) : null) ?? bancaId;

    const kindByBancaCampaign = new Map<string, string>();
    if (fetchedCampaignIds.length > 0 && scopeBancas.length > 0) {
      const { data: kindRows } = await supabaseServiceRole
        .from('meta_campaigns')
        .select('banca_id,campaign_id,campaign_kind')
        .in('campaign_id', fetchedCampaignIds)
        .in('banca_id', scopeBancas);
      for (const row of kindRows ?? []) {
        const r = row as { banca_id: string; campaign_id: string; campaign_kind?: string | null };
        kindByBancaCampaign.set(`${r.banca_id}:${r.campaign_id}`, String(r.campaign_kind || 'normal'));
      }
    }

    const ins0 = insights[0] as unknown as Record<string, unknown> | undefined;
    const camp0 = campaigns[0] as unknown as Record<string, unknown> | undefined;
    const campaignStatusStats = campaigns.reduce<Record<string, number>>((acc, c) => {
      const s = String(c.effective_status || c.status || 'UNKNOWN');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const campaignObjectiveStats = campaigns.reduce<Record<string, number>>((acc, c) => {
      const o = String(c.objective || 'UNKNOWN');
      acc[o] = (acc[o] || 0) + 1;
      return acc;
    }, {});
    const campaignOwnerPreview = campaigns.slice(0, 20).map((c) => ({
      campaign_id: c.id,
      campaign_name: c.name ?? null,
      owner_banca_id: resolveCampaignOwner(c.id),
    }));
    const metaMetricsByCampaign = new Map<
      string,
      { campaign_id: string; campaign_name: string | null; reach: number; impressions: number; clicks: number; leads: number; spend: number; insights_rows: number }
    >();
    for (const ins of insights) {
      const cid = String(ins.campaign_id ?? '').trim();
      if (!cid) continue;
      const cur =
        metaMetricsByCampaign.get(cid) ?? {
          campaign_id: cid,
          campaign_name: (ins.campaign_name as string | undefined) ?? null,
          reach: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          spend: 0,
          insights_rows: 0,
        };
      cur.reach += Number(ins.reach) || 0;
      cur.impressions += Number(ins.impressions) || 0;
      cur.clicks += Number(ins.clicks) || 0;
      cur.leads += Number((ins as { leads?: number | string | null }).leads) || 0;
      cur.spend += Number(ins.spend) || 0;
      cur.insights_rows += 1;
      if (!cur.campaign_name && ins.campaign_name) cur.campaign_name = String(ins.campaign_name);
      metaMetricsByCampaign.set(cid, cur);
    }
    const topCampaignMetricsFromMeta = [...metaMetricsByCampaign.values()]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 20);
    const metricCoverageStats = {
      campaigns_from_meta: campaigns.length,
      campaigns_with_metrics: metaMetricsByCampaign.size,
      campaigns_without_metrics: Math.max(campaigns.length - metaMetricsByCampaign.size, 0),
      insights_rows_from_meta: insights.length,
    };
    const insightsWithCpa = insights.filter(
      (ins) => Array.isArray(ins.cost_per_action_type) && ins.cost_per_action_type.length > 0
    );
    const firstWithCpa = insightsWithCpa[0] as unknown as Record<string, unknown> | undefined;
    const adAcct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    logMetaReturn('runSync ← Meta (antes de gravar no DB)', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      ad_account_id: adAcct,
      time_range: timeRange,
      date_preset_param: datePreset,
      campaigns_from_meta: campaigns.length,
      first_campaign_keys: camp0 ? Object.keys(camp0) : [],
      first_campaign_sample: camp0
        ? {
            id: camp0.id ?? null,
            name: camp0.name ?? null,
            objective: camp0.objective ?? null,
            status: camp0.status ?? null,
            effective_status: camp0.effective_status ?? null,
            daily_budget: camp0.daily_budget ?? null,
            lifetime_budget: camp0.lifetime_budget ?? null,
            start_time: camp0.start_time ?? null,
            stop_time: camp0.stop_time ?? null,
          }
        : null,
      campaign_status_stats: campaignStatusStats,
      campaign_objective_stats: campaignObjectiveStats,
      campaign_owner_preview: campaignOwnerPreview,
      campaign_metrics_coverage: metricCoverageStats,
      top_campaign_metrics_from_meta: topCampaignMetricsFromMeta,
      adsets_from_meta: adsets.length,
      insights_rows_from_meta: insights.length,
      account_finance: accountFinance
        ? {
            currency: accountFinance.currency ?? null,
            timezone_name: accountFinance.timezone_name ?? null,
            has_amount_spent: accountFinance.amount_spent != null,
            has_balance: accountFinance.balance != null,
          }
        : null,
      first_insight_keys: ins0 ? Object.keys(ins0) : [],
      first_insight_sample: ins0
        ? {
            date_start: ins0.date_start ?? null,
            campaign_id: ins0.campaign_id ?? null,
            campaign_name: ins0.campaign_name ?? null,
            spend: ins0.spend ?? null,
            impressions: ins0.impressions ?? null,
            actions_len: Array.isArray(ins0.actions) ? (ins0.actions as unknown[]).length : 0,
            cost_per_action_type_len: Array.isArray(ins0.cost_per_action_type)
              ? (ins0.cost_per_action_type as unknown[]).length
              : 0,
            cost_per_action_type_sample: Array.isArray(ins0.cost_per_action_type)
              ? (ins0.cost_per_action_type as unknown[]).slice(0, 5)
              : null,
          }
        : null,
      cost_per_action_type_stats: {
        insights_with_cost_per_action_type: insightsWithCpa.length,
        first_campaign_with_cost_per_action_type: firstWithCpa?.campaign_id ?? null,
        first_cost_per_action_type_sample: Array.isArray(firstWithCpa?.cost_per_action_type)
          ? (firstWithCpa!.cost_per_action_type as unknown[]).slice(0, 5)
          : null,
      },
    });

    const accountCurrency = accountFinance?.currency || 'BRL';

    const now = new Date().toISOString();

    for (const c of campaigns) {
      const ownerBancaId = resolveCampaignOwner(c.id);
      const preservedKind = kindByBancaCampaign.get(`${ownerBancaId}:${c.id}`) ?? 'normal';
      const { error } = await supabaseServiceRole
        .from('meta_campaigns')
        .upsert(
          {
            banca_id: ownerBancaId,
            campaign_id: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            effective_status: c.effective_status,
            daily_budget: normalizeBudget(c.daily_budget),
            lifetime_budget: normalizeBudget(c.lifetime_budget),
            start_time: c.start_time || null,
            stop_time: c.stop_time || null,
            campaign_kind: preservedKind,
            updated_at: now,
          },
          { onConflict: 'banca_id,campaign_id' }
        );
      if (!error) campaignsCount++;
    }

    for (const a of adsets) {
      const ownerBancaId = resolveCampaignOwner(a.campaign_id);
      const { error } = await supabaseServiceRole
        .from('meta_adsets')
        .upsert(
          {
            banca_id: ownerBancaId,
            adset_id: a.id,
            campaign_id: a.campaign_id,
            name: a.name,
            status: a.status,
            effective_status: a.effective_status,
            daily_budget: normalizeBudget(a.daily_budget),
            lifetime_budget: normalizeBudget(a.lifetime_budget),
            billing_event: a.billing_event,
            optimization_goal: a.optimization_goal,
            start_time: a.start_time || null,
            end_time: a.end_time || null,
            updated_at: now,
          },
          { onConflict: 'banca_id,adset_id' }
        );
      if (!error) adsetsCount++;
    }

    for (const ins of insights) {
      const ownerBancaId = resolveCampaignOwner(ins.campaign_id);
      const row = mapInsightToRow(ins, ownerBancaId);
      const { error } = await supabaseServiceRole
        .from('meta_insights_daily')
        .upsert(
          {
            ...row,
            updated_at: now,
          },
          { onConflict: 'banca_id,date,campaign_id' }
        );
      if (!error) insightsCount++;
    }

    const presetLabel = insightsSourceLabel;
    if (integrationIdForConfig) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: now,
        last_sync_error: null,
        last_sync_date_preset: presetLabel,
        ad_account_id: adAccountId,
        currency: accountCurrency,
        updated_at: now,
        })
        .eq('id', integrationIdForConfig);
    } else {
      await supabaseServiceRole
        .from('meta_integrations')
        .update({
          last_sync_at: now,
          last_sync_error: null,
          last_sync_date_preset: presetLabel,
          ad_account_id: adAccountId,
          currency: accountCurrency,
          updated_at: now,
        })
        .eq('banca_id', bancaId);
    }

    logMetaReturn('runSync → DB concluído', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      ad_account_id: adAcct,
      campaigns_upsert_ok: campaignsCount,
      adsets_upsert_ok: adsetsCount,
      insights_upsert_ok: insightsCount,
      preset_label: presetLabel,
      currency: accountCurrency,
    });

    return {
      success: true,
      campaignsCount,
      adsetsCount,
      insightsCount,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Erro ao sincronizar';
    logMetaReturn('runSync ✗', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      error: errMsg,
    });
    const ts = new Date().toISOString();
    if (integrationIdForConfig) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: ts,
        last_sync_error: errMsg,
        updated_at: ts,
        })
        .eq('id', integrationIdForConfig);
    } else {
      await supabaseServiceRole
        .from('meta_integrations')
        .update({
          last_sync_at: ts,
          last_sync_error: errMsg,
          updated_at: ts,
        })
        .eq('banca_id', bancaId);
    }

    return { success: false, error: errMsg };
  }
}

export async function runSync(bancaId: string, datePreset = DEFAULT_DATE_PRESET): Promise<{
  success: boolean;
  campaignsCount?: number;
  adsetsCount?: number;
  insightsCount?: number;
  error?: string;
}> {
  const shared = await listIntegrationIdsByBanca(bancaId);
  const targets: Array<string | null> = shared.length > 0 ? [...shared] : [null];

  let campaignsCount = 0;
  let adsetsCount = 0;
  let insightsCount = 0;
  const errors: string[] = [];

  for (const tid of targets) {
    const r = await runSyncSingle(bancaId, tid, datePreset);
    if (!r.success) {
      errors.push(tid ? `${tid.slice(0, 8)}…: ${r.error || 'falha'}` : r.error || 'falha');
    } else {
      campaignsCount += r.campaignsCount ?? 0;
      adsetsCount += r.adsetsCount ?? 0;
      insightsCount += r.insightsCount ?? 0;
    }
  }

  return {
    success: errors.length === 0,
    error: errors.length ? errors.join(' | ') : undefined,
    campaignsCount,
    adsetsCount,
    insightsCount,
  };
}
