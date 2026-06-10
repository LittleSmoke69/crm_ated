/**
 * Série diária para o card "Gasto de Ads × Depósito".
 *
 * - GASTO diário: agregação LIVE da Meta (mesma fonte do painel — `fetchAdminMetaLiveAggregate`),
 *   que já devolve `daily_spend` em BRL por dia (insights `time_increment=1`, deduplicado por
 *   campanha e convertido para BRL). Não depende do sync local `meta_insights_daily`.
 * - DEPÓSITO (volume de recarga) diário: mesma fonte do ranking Banca×Ads — CRM externa
 *   `/api/crm/dashboard-metrics` via `fetchDashboardMetrics`, que retorna `total_deposited`
 *   por intervalo. Como não há quebra diária no endpoint, chamamos por dia (since=until=dia)
 *   para cada banca do escopo, com concorrência limitada (igual ao ranking, `maxDuration=300`).
 *
 * Escopo de bancas:
 * - `bancaIds` explícito → exatamente essas bancas.
 * - vazio (Todas as bancas) → bancas presentes na agregação LIVE (que tiveram gasto no período),
 *   mantendo as duas linhas comparáveis e limitando o fan-out externo de depósitos.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchDashboardMetrics } from '@/lib/services/dashboard/dono-banca';
import { formatMetaCalendarDayYmd } from '@/lib/meta/metaAdsService';
import { fetchAdminMetaLiveAggregate } from '@/lib/services/meta-sync-service';

export type SpendVsDepositDailyPoint = {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  deposit: number;
};

export type SpendVsDepositDailyResult = {
  period: { date_from: string; date_to: string; tz: string };
  banca_ids: string[];
  days: SpendVsDepositDailyPoint[];
  totals: { spend: number; deposit: number };
  /** Pares (banca, dia) cujo fetch de depósito falhou (CRM offline / URL inválida). */
  deposit_failures: number;
};

export type GetMetaSpendVsDepositDailyOptions = {
  dateFrom: string;
  dateTo: string;
  tz?: string | null;
  /** Escopo explícito; vazio/ausente = todas as bancas com gasto no período. */
  bancaIds?: string[];
  /**
   * Quando true, NÃO roda a agregação LIVE da Meta (gasto fica vazio) e usa apenas `bancaIds`
   * para o fan-out de depósitos. Usado pelo card quando o gasto diário já foi calculado pela
   * página (stream live) — evita rodar a Meta duas vezes. Exige `bancaIds` preenchido.
   */
  depositsOnly?: boolean;
};

const DEFAULT_TZ = 'America/Sao_Paulo';
/** Bancas processadas em paralelo (1 chamada de range por banca). */
const DEPOSIT_BANCA_CONCURRENCY = 8;
/**
 * Timeout por chamada de depósito. O `dashboard-metrics` não tem quebra diária e custa
 * praticamente o mesmo para 1 dia ou para o range inteiro — então fazemos UMA chamada de
 * range por banca (total do período). CRMs lentas-mas-vivas respondem em ~20s (ex.: LotoX);
 * 30s acomoda e ainda corta mortas bem antes dos 60s default do cliente.
 */
const DEPOSIT_CALL_TIMEOUT_MS = 30000;
/** Teto de segurança para o nº de bancas consultadas. */
const MAX_DEPOSIT_BANCAS = 600;
/**
 * Cache em memória por (banca, range). Janela só com dias passados é imutável → TTL longo;
 * janela que inclui "hoje" → TTL curto. Evita reconsultar CRMs lentas a cada refresh.
 */
const DEPOSIT_CACHE_TTL_TODAY_MS = 60_000;
const DEPOSIT_CACHE_TTL_PAST_MS = 6 * 60 * 60 * 1000;
const depositRangeCache = new Map<string, { value: number; expires: number }>();

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Busca (com cache + timeout) o depósito TOTAL de um range para uma banca. Nunca rejeita. */
async function fetchDepositRange(
  url: string,
  dateFrom: string,
  dateTo: string,
  todayYmd: string
): Promise<{ value: number; ok: boolean }> {
  const key = `${url}|${dateFrom}|${dateTo}`;
  const cached = depositRangeCache.get(key);
  if (cached && cached.expires > Date.now()) return { value: cached.value, ok: true };
  try {
    const metrics = await fetchDashboardMetrics(url, dateFrom, dateTo, AbortSignal.timeout(DEPOSIT_CALL_TIMEOUT_MS));
    const value = Number(metrics?.total_deposited) || 0;
    const ttl = dateTo >= todayYmd ? DEPOSIT_CACHE_TTL_TODAY_MS : DEPOSIT_CACHE_TTL_PAST_MS;
    depositRangeCache.set(key, { value, expires: Date.now() + ttl });
    return { value, ok: true };
  } catch {
    // Não cacheia falha: próximo load tenta de novo.
    return { value: 0, ok: false };
  }
}

function normalizeBancaUrlAbsolute(bancaUrl: string | null | undefined): string | null {
  if (!bancaUrl) return null;
  let normalized = String(bancaUrl).trim().replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  normalized = normalized.replace(/\/+$/, '').trim();
  if (!normalized) return null;
  return `https://${normalized}`.toLowerCase();
}

/** Lista inclusiva de dias YYYY-MM-DD entre from e to (UTC, sem horário). */
function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return days;
  for (let t = start; t <= end; t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** Pool simples: no máximo `limit` workers; worker nunca deve rejeitar. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const max = Math.max(1, Math.min(limit, items.length || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: max }, () => run()));
  return results;
}

/** URLs absolutas das bancas do escopo (id → url normalizada). */
async function fetchBancaUrls(bancaIds: string[]): Promise<Map<string, string>> {
  const urlById = new Map<string, string>();
  if (bancaIds.length === 0) return urlById;
  const { data, error } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, url, name')
    .in('id', bancaIds);
  if (error) throw new Error(`Erro ao buscar URLs das bancas: ${error.message}`);
  for (const r of (data ?? []) as Array<{ id: string; url: string | null; name: string | null }>) {
    const name = String(r.name ?? '').trim().toLowerCase();
    if (name === 'sua banca') continue; // placeholder do produto
    const url = normalizeBancaUrlAbsolute(r.url);
    if (url) urlById.set(String(r.id), url);
  }
  return urlById;
}

export async function getMetaSpendVsDepositDaily(
  opts: GetMetaSpendVsDepositDailyOptions
): Promise<SpendVsDepositDailyResult> {
  const tz = (opts.tz && opts.tz.trim()) || DEFAULT_TZ;
  let dateFrom = (opts.dateFrom || '').trim();
  let dateTo = (opts.dateTo || '').trim();
  if (!YMD.test(dateFrom)) dateFrom = formatMetaCalendarDayYmd(tz);
  if (!YMD.test(dateTo)) dateTo = dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];

  const explicit = Array.from(
    new Set((opts.bancaIds ?? []).map((s) => String(s ?? '').trim()).filter(Boolean))
  );

  const days = enumerateDays(dateFrom, dateTo);

  const spendByDay = new Map<string, number>();
  let scopeBancaIds: string[];

  if (opts.depositsOnly) {
    // Gasto já calculado pela página; aqui só os depósitos do escopo informado.
    scopeBancaIds = explicit;
  } else {
    /**
     * GASTO: agregação LIVE da Meta (mesma do painel). Mapeia o escopo do card para os
     * parâmetros do live aggregate: 1 banca → overviewBancaId; várias → scopeBancaIds; nenhuma → todas.
     */
    const live = await fetchAdminMetaLiveAggregate({
      dateFrom,
      dateTo,
      scopeBancaIds: explicit.length > 1 ? explicit : [],
      overviewBancaId: explicit.length === 1 ? explicit[0] : null,
      activeOnly: true,
      // Card só usa daily_spend; pular as `/activities` (cobranças) acelera a fase Meta.
      skipBilling: true,
    });
    for (const d of live.daily_spend ?? []) {
      const day = String(d.date ?? '').slice(0, 10);
      if (!YMD.test(day)) continue;
      spendByDay.set(day, (spendByDay.get(day) ?? 0) + (Number(d.spend_brl) || 0));
    }
    /**
     * Escopo de bancas para o DEPÓSITO: explícito quando informado; senão, as bancas presentes
     * na agregação LIVE (que tiveram gasto no período) — mantém as duas linhas comparáveis.
     */
    scopeBancaIds =
      explicit.length > 0
        ? explicit
        : Array.from(
            new Set(
              (live.campaigns ?? [])
                .map((c) => String((c as { banca_id?: unknown }).banca_id ?? '').trim())
                .filter(Boolean)
            )
          );
  }

  const urlById = await fetchBancaUrls(scopeBancaIds);

  /**
   * DEPÓSITO: UMA chamada de range por banca (total do período). A CRM não devolve quebra
   * diária e custa o mesmo para 1 dia ou o range inteiro — então 1 chamada/banca evita o
   * fan-out de N dias e a sobrecarga das CRMs lentas. Bancas em paralelo, cada uma 1 chamada.
   */
  let bancaUrls = Array.from(urlById.values());
  if (bancaUrls.length > MAX_DEPOSIT_BANCAS) {
    console.warn('[spend-vs-deposit-daily] nº de bancas acima do teto — cortando', {
      bancas_original: bancaUrls.length,
      bancas_kept: MAX_DEPOSIT_BANCAS,
    });
    bancaUrls = bancaUrls.slice(0, MAX_DEPOSIT_BANCAS);
  }

  const todayYmd = formatMetaCalendarDayYmd(tz);
  let depositTotal = 0;
  let depositFailures = 0;
  const perBanca = await mapPool(bancaUrls, DEPOSIT_BANCA_CONCURRENCY, (url) =>
    fetchDepositRange(url, dateFrom, dateTo, todayYmd)
  );
  for (const r of perBanca) {
    if (!r.ok) {
      depositFailures += 1;
      continue;
    }
    depositTotal += r.value;
  }

  /**
   * Distribui o total de depósito uniformemente pelos dias (linha de referência = média/dia).
   * O `totals.deposit` (soma dos pontos) reconcilia com o total real consultado.
   */
  const depositPerDay = days.length > 0 ? depositTotal / days.length : 0;
  const points: SpendVsDepositDailyPoint[] = days.map((date) => ({
    date,
    spend: Math.round((spendByDay.get(date) ?? 0) * 100) / 100,
    deposit: Math.round(depositPerDay * 100) / 100,
  }));

  const totals = points.reduce(
    (acc, p) => {
      acc.spend += p.spend;
      acc.deposit += p.deposit;
      return acc;
    },
    { spend: 0, deposit: 0 }
  );
  totals.spend = Math.round(totals.spend * 100) / 100;
  totals.deposit = Math.round(totals.deposit * 100) / 100;

  return {
    period: { date_from: dateFrom, date_to: dateTo, tz },
    banca_ids: scopeBancaIds,
    days: points,
    totals,
    deposit_failures: depositFailures,
  };
}
