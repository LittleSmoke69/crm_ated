/**
 * Métricas de Rodadas de Investimento de ADS (por consultor).
 *
 * Para uma janela [dateFrom, dateTo] e um consultor:
 *  - GASTO REAL = Σ meta_insights_daily.spend das campanhas atribuídas ao consultor
 *    (atribuição: colunas ads_attribution_consultor_ids/_id em meta_campaigns +
 *     vínculos meta_campaign_consultors). Só Meta Ads, alimenta a barra de progresso.
 *  - LTV / DEPÓSITOS / LUCRO = CRM `/api/crm/dashboard-metrics?consultant=email`
 *    (mesma fonte do "Meu Desempenho" e do ranking Banca×Ads).
 *
 * NOTA de moeda: spend é somado cru (moeda da conta), tratado como BRL — mesmo
 * comportamento de computeConsultantAdsSummary. Contas não-BRL podem ser convertidas
 * depois via convertMetaSpendToBrl sem mudar a interface deste service.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export interface RoundMetricInput {
  bancaId: string;
  consultorId: string;
  consultorEmail: string;
  /** YYYY-MM-DD */
  dateFrom: string;
  /** YYYY-MM-DD */
  dateTo: string;
  metaGasto: number;
  /** Se true, monta a série diária de depósitos/LTV (1 chamada dashboard-metrics por dia). */
  includeDailyDeposits?: boolean;
}

export interface DailySpendPoint {
  date: string;
  spend: number;
  /** Acumulado de gasto desde data_inicial. */
  cumulative_spend: number;
}

export interface DailyDepositPoint {
  date: string;
  deposited: number;
  deposits_count: number;
  cumulative_deposited: number;
}

export interface RoundMetricResult {
  spend_real: number;
  meta_gasto: number;
  /** 0..100+ (pode passar de 100 se estourar a meta). */
  progress_pct: number;
  campaign_ids: string[];
  metrics: {
    total_leads: number;
    total_deposited: number;
    total_deposits_count: number;
    total_bets: number;
    total_prizes: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
  } | null;
  metrics_error: string | null;
  /** ROAS = total_deposited ÷ spend_real (null se sem gasto). */
  roas: number | null;
  daily_spend: DailySpendPoint[];
  daily_deposits: DailyDepositPoint[] | null;
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeBancaUrl(raw: string | null | undefined): string | null {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim();
  if (!cleaned) return null;
  return `https://${cleaned}`;
}

/** Lista os dias YYYY-MM-DD de [from, to] inclusivo (limite de segurança em 366). */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let d = start, i = 0; d <= end && i < 366; d = new Date(d.getTime() + 86400000), i++) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Campanhas Meta atribuídas ao consultor na banca (mesma lógica de
 * computeConsultantAdsSummary, porém só as duas fontes explícitas — sem inferência
 * por redirect — para manter o número idêntico entre agregado e série diária).
 */
async function resolveConsultorCampaignIds(bancaId: string, consultorId: string): Promise<string[]> {
  const campaignIds = new Set<string>();

  // 1) Atribuição explícita em meta_campaigns (coluna pode não existir em bases antigas → 42703).
  try {
    const { data: attrRows, error } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, ads_attribution_consultor_id, ads_attribution_consultor_ids')
      .eq('banca_id', bancaId);
    if (!error && Array.isArray(attrRows)) {
      for (const r of attrRows as Array<{
        campaign_id?: string;
        ads_attribution_consultor_id?: string | null;
        ads_attribution_consultor_ids?: string[] | null;
      }>) {
        const cp = String(r.campaign_id ?? '').trim();
        if (!cp) continue;
        const ids = new Set<string>();
        for (const x of Array.isArray(r.ads_attribution_consultor_ids) ? r.ads_attribution_consultor_ids : []) {
          const id = String(x ?? '').trim();
          if (id) ids.add(id);
        }
        if (ids.size === 0) {
          const leg = String(r.ads_attribution_consultor_id ?? '').trim();
          if (leg) ids.add(leg);
        }
        if (ids.has(consultorId)) campaignIds.add(cp);
      }
    } else if (error && error.code !== '42703') {
      console.warn('[InvestmentRounds] meta_campaigns attribution:', error.message);
    }
  } catch (e: unknown) {
    console.warn('[InvestmentRounds] attribution column skip:', (e as { message?: string })?.message);
  }

  // 2) Vínculos diretos meta_campaign_consultors.
  const { data: links } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id')
    .eq('banca_id', bancaId)
    .eq('consultor_id', consultorId);
  for (const row of links ?? []) {
    const c = String((row as { campaign_id?: string }).campaign_id ?? '').trim();
    if (c) campaignIds.add(c);
  }

  return Array.from(campaignIds);
}

/** Série diária de gasto (BRL) das campanhas, com acumulado desde data_inicial. */
async function fetchDailySpend(
  bancaId: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<{ total: number; daily: DailySpendPoint[] }> {
  if (campaignIds.length === 0) return { total: 0, daily: [] };

  const { data, error } = await supabaseServiceRole
    .from('meta_insights_daily')
    .select('date, spend')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds)
    .gte('date', dateFrom)
    .lte('date', dateTo);

  if (error || !Array.isArray(data)) {
    if (error) console.warn('[InvestmentRounds] meta_insights_daily:', error.message);
    return { total: 0, daily: [] };
  }

  const byDate = new Map<string, number>();
  let total = 0;
  for (const row of data as Array<{ date: string; spend: number | string }>) {
    const day = String(row.date).slice(0, 10);
    const v = Number(row.spend) || 0;
    byDate.set(day, (byDate.get(day) || 0) + v);
    total += v;
  }

  let cumulative = 0;
  const daily: DailySpendPoint[] = eachDay(dateFrom, dateTo).map((date) => {
    const spend = roundMoney(byDate.get(date) || 0);
    cumulative = roundMoney(cumulative + spend);
    return { date, spend, cumulative_spend: cumulative };
  });

  return { total: roundMoney(total), daily };
}

interface DashboardMetricsRaw {
  total_leads?: number;
  total_deposited?: number;
  total_deposits_count?: number;
  total_bets?: number;
  total_prizes?: number;
  active_leads?: number;
  conversion_rate?: number;
  ltv_avg?: number;
  net_profit?: number;
}

/** Chama o CRM dashboard-metrics para o consultor numa janela. */
async function fetchDashboardMetrics(
  bancaUrl: string,
  consultorEmail: string,
  dateFrom: string,
  dateTo: string
): Promise<DashboardMetricsRaw | null> {
  const base = normalizeBancaUrl(bancaUrl);
  if (!base || !consultorEmail) return null;

  const url = new URL(`${base}/api/crm/dashboard-metrics`);
  url.searchParams.append('consultant', consultorEmail);
  url.searchParams.append('date_from', dateFrom);
  url.searchParams.append('date_to', dateTo);

  const apiKey = process.env.CRM_API_KEY;
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
  });
  if (!resp.ok) {
    throw new Error(`dashboard-metrics ${resp.status}`);
  }
  const json = await resp.json();
  if (!json?.success || !json?.metrics) return null;
  return json.metrics as DashboardMetricsRaw;
}

/** Executa worker sobre items com concorrência limitada, preservando ordem. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Calcula todas as métricas de uma rodada (gasto real, progresso, LTV/depósitos,
 * ROAS e séries diárias).
 */
export async function computeRoundMetric(input: RoundMetricInput): Promise<RoundMetricResult> {
  const { bancaId, consultorId, consultorEmail, dateFrom, dateTo, metaGasto } = input;

  // banca url (para dashboard-metrics)
  const { data: bancaRow } = await supabaseServiceRole
    .from('crm_bancas')
    .select('url')
    .eq('id', bancaId)
    .maybeSingle();
  const bancaUrl = (bancaRow as { url?: string } | null)?.url ?? null;

  const campaignIds = await resolveConsultorCampaignIds(bancaId, consultorId);
  const { total: spendReal, daily: dailySpend } = await fetchDailySpend(bancaId, campaignIds, dateFrom, dateTo);

  const progressPct = metaGasto > 0 ? roundMoney((spendReal / metaGasto) * 100) : 0;

  let metrics: RoundMetricResult['metrics'] = null;
  let metricsError: string | null = null;
  try {
    const raw = bancaUrl ? await fetchDashboardMetrics(bancaUrl, consultorEmail, dateFrom, dateTo) : null;
    if (raw) {
      metrics = {
        total_leads: Number(raw.total_leads) || 0,
        total_deposited: roundMoney(raw.total_deposited || 0),
        total_deposits_count: Number(raw.total_deposits_count) || 0,
        total_bets: roundMoney(raw.total_bets || 0),
        total_prizes: roundMoney(raw.total_prizes || 0),
        active_leads: Number(raw.active_leads) || 0,
        conversion_rate: Number(raw.conversion_rate) || 0,
        ltv_avg: roundMoney(raw.ltv_avg || 0),
        net_profit: roundMoney(raw.net_profit || 0),
      };
    } else if (!bancaUrl) {
      metricsError = 'Banca sem URL configurada';
    } else {
      metricsError = 'Dados não disponíveis';
    }
  } catch (e: unknown) {
    metricsError = (e as { message?: string })?.message || 'Erro ao buscar métricas';
  }

  const roas = metrics && spendReal > 0 ? roundMoney(metrics.total_deposited / spendReal) : null;

  // Série diária de depósitos (opcional): 1 chamada dashboard-metrics por dia.
  let dailyDeposits: DailyDepositPoint[] | null = null;
  if (input.includeDailyDeposits && bancaUrl) {
    const days = eachDay(dateFrom, dateTo);
    const points = await mapLimit(days, 5, async (day) => {
      try {
        const raw = await fetchDashboardMetrics(bancaUrl, consultorEmail, day, day);
        return {
          date: day,
          deposited: roundMoney(raw?.total_deposited || 0),
          deposits_count: Number(raw?.total_deposits_count) || 0,
        };
      } catch {
        return { date: day, deposited: 0, deposits_count: 0 };
      }
    });
    let cumulative = 0;
    dailyDeposits = points.map((p) => {
      cumulative = roundMoney(cumulative + p.deposited);
      return { ...p, cumulative_deposited: cumulative };
    });
  }

  return {
    spend_real: spendReal,
    meta_gasto: roundMoney(metaGasto),
    progress_pct: progressPct,
    campaign_ids: campaignIds,
    metrics,
    metrics_error: metricsError,
    roas,
    daily_spend: dailySpend,
    daily_deposits: dailyDeposits,
  };
}
