/**
 * Ranking diário "Banca x ADS" — Conciliação.
 *
 * Cruza, por dia e por banca:
 *   - Gasto LIVE do Meta Ads (Marketing API via `consolidateActiveCampaignsSpendAllIntegrations`,
 *     filtra campanhas com `delivery_info=active` — só entra banca com ads ativos).
 *   - Métricas operacionais da banca (CRM `/api/crm/dashboard-metrics` — mesma fonte do "Resumo Geral").
 *
 * Retorna apenas bancas com ads ativos no dia, ordenadas por gasto desc, com métricas
 * derivadas (ROI, ROAS, margem, status) prontas para a tabela do front.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchDashboardMetrics } from '@/lib/services/dashboard/dono-banca';
import {
  consolidateActiveCampaignsSpendAllIntegrations,
} from '@/lib/services/meta-sync-service';
import { formatMetaCalendarDayYmd } from '@/lib/meta/metaAdsService';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** Normaliza a URL da banca para um endpoint absoluto compatível com fetchDashboardMetrics. */
function normalizeBancaUrlAbsolute(bancaUrl: string | null | undefined): string | null {
  if (!bancaUrl) return null;
  let normalized = String(bancaUrl).trim();
  if (!normalized) return null;
  normalized = normalized.replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  normalized = normalized.replace(/\/+$/, '').trim();
  if (!normalized) return null;
  return `https://${normalized}`.toLowerCase();
}

export type BancaXAdsRankingRowAds = {
  spend: number;
  active_campaigns: number;
  currency: string;
};

export type BancaXAdsRankingRowBanca = {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  awarded_clients_count: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg: number;
  net_profit: number;
  /** true quando o CRM externo respondeu OK. */
  available: boolean;
};

export type BancaXAdsRankingRowConciliacao = {
  /** depositado - gasto. */
  roi_absoluto: number;
  /** depositado / gasto. null quando gasto = 0. */
  roas: number | null;
  /** gasto / awarded_clients_count. null quando não há depósitos. */
  cpa_deposito: number | null;
  /** depositado / gasto * 100. null quando gasto = 0. */
  cobertura_gasto_pct: number | null;
  /** (depositado - gasto) / depositado * 100. null quando depositado = 0. */
  margem_pct: number | null;
  /** verde: ROI ≥ 0 / amarelo: ROI<0 e ROAS ≥ 0.5 / vermelho: ROAS<0.5. */
  status: 'positivo' | 'atencao' | 'negativo' | 'sem_dados';
};

export type BancaXAdsRankingRow = {
  rank: number;
  banca_id: string;
  banca_name: string;
  banca_url: string;
  ads: BancaXAdsRankingRowAds;
  banca: BancaXAdsRankingRowBanca;
  conciliacao: BancaXAdsRankingRowConciliacao;
};

export type BancaXAdsRankingTotals = {
  spend_total: number;
  active_campaigns_total: number;
  leads_total: number;
  deposited_total: number;
  bets_total: number;
  prizes_total: number;
  roi_total: number;
  roas_medio: number | null;
  bancas_total: number;
  bancas_crm_indisponivel: number;
};

export type BancaXAdsRankingResult = {
  period: { date: string; tz: string };
  rows: BancaXAdsRankingRow[];
  totals: BancaXAdsRankingTotals;
};

export type BancaXAdsRankingOptions = {
  /** YYYY-MM-DD. Default = hoje em `tz`. */
  date?: string | null;
  /** IANA timezone. Default America/Sao_Paulo. */
  tz?: string | null;
  /** Limite opcional para reduzir o nº de chamadas ao CRM externo durante teste. */
  limit?: number | null;
};

type CrmBancaRow = { id: string; name: string | null; url: string | null };

/** Mapa `campaign_id` → `banca_id` do snapshot Supabase para resolver atribuição quando integração é compartilhada. */
async function fetchCampaignToBancaMap(): Promise<Map<string, string>> {
  const { data, error } = await supabaseServiceRole
    .from('meta_campaigns')
    .select('campaign_id, banca_id');
  if (error) {
    console.warn('[banca-x-ads-ranking] meta_campaigns lookup error:', error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const cid = String((row as { campaign_id?: string | null }).campaign_id ?? '');
    const bid = String((row as { banca_id?: string | null }).banca_id ?? '');
    if (cid && bid) map.set(cid, bid);
  }
  return map;
}

type LiveAdsAggregate = {
  spendByBanca: Map<string, number>;
  campaignsByBanca: Map<string, number>;
  bancasWithActiveAds: Set<string>;
};

/**
 * Roda o agregador LIVE do Meta Graph para o dia pedido e atribui o spend
 * de cada campanha ao seu `banca_id` real via lookup em `meta_campaigns`.
 * Para integração com 1 só banca cai no fallback direto.
 */
async function fetchLiveAdsForDay(date: string, tz: string): Promise<LiveAdsAggregate> {
  const campaignToBanca = await fetchCampaignToBancaMap();

  const report = await consolidateActiveCampaignsSpendAllIntegrations({
    timeRange: { since: date, until: date },
    timeIncrement: 1,
    calendarTimeZone: tz,
  });

  const spendByBanca = new Map<string, number>();
  const campaignsByBanca = new Map<string, number>();
  const bancasWithActiveAds = new Set<string>();

  for (const campaign of report.campaigns) {
    const resolved = campaignToBanca.get(String(campaign.id));
    const fallback = campaign.banca_ids[0];
    const targetBanca = resolved || fallback;
    if (!targetBanca) continue;

    bancasWithActiveAds.add(targetBanca);
    const spend = Number(campaign.spend) || 0;
    spendByBanca.set(targetBanca, (spendByBanca.get(targetBanca) ?? 0) + spend);
    campaignsByBanca.set(targetBanca, (campaignsByBanca.get(targetBanca) ?? 0) + 1);
  }

  console.log('[banca-x-ads-ranking] LIVE ads aggregate', {
    date,
    tz,
    integrations_ok: report.summary.integrations_ok,
    integrations_failed: report.summary.integrations_failed,
    campaigns_total: report.summary.campaigns_total,
    total_spend: report.summary.total_spend,
    bancas_with_active_ads: bancasWithActiveAds.size,
  });

  return { spendByBanca, campaignsByBanca, bancasWithActiveAds };
}

function computeConciliacao(
  spend: number,
  deposited: number,
  awardedCount: number,
  bancaAvailable: boolean
): BancaXAdsRankingRowConciliacao {
  const roi_absoluto = deposited - spend;
  const roas = spend > 0 ? deposited / spend : null;
  const cpa_deposito = awardedCount > 0 ? spend / awardedCount : null;
  const cobertura_gasto_pct = spend > 0 ? (deposited / spend) * 100 : null;
  const margem_pct = deposited > 0 ? (roi_absoluto / deposited) * 100 : null;

  let status: BancaXAdsRankingRowConciliacao['status'];
  if (!bancaAvailable && spend === 0) {
    status = 'sem_dados';
  } else if (roi_absoluto >= 0) {
    status = 'positivo';
  } else if (roas != null && roas >= 0.5) {
    status = 'atencao';
  } else {
    status = 'negativo';
  }

  return { roi_absoluto, roas, cpa_deposito, cobertura_gasto_pct, margem_pct, status };
}

/** Monta o ranking diário só com bancas que têm ads ativos no dia (campanhas com delivery_info=active). */
export async function getBancaXAdsRanking(opts: BancaXAdsRankingOptions = {}): Promise<BancaXAdsRankingResult> {
  const tz = (opts.tz && opts.tz.trim()) || DEFAULT_TZ;
  const date = (opts.date && opts.date.trim()) || formatMetaCalendarDayYmd(tz);

  const [bancasRes, liveAds] = await Promise.all([
    supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .order('name', { ascending: true }),
    fetchLiveAdsForDay(date, tz),
  ]);

  if (bancasRes.error) {
    throw new Error(`Erro ao buscar bancas: ${bancasRes.error.message}`);
  }

  let bancas = (bancasRes.data ?? []) as CrmBancaRow[];
  // Filtra placeholders e mantém só bancas com ads ativos no dia.
  bancas = bancas.filter((b) => {
    const name = String(b.name || '').trim().toLowerCase();
    if (name === 'sua banca') return false;
    return liveAds.bancasWithActiveAds.has(String(b.id));
  });
  if (Number.isFinite(opts.limit as number) && (opts.limit as number) > 0) {
    bancas = bancas.slice(0, opts.limit as number);
  }

  // Chama dashboard-metrics em paralelo por banca (não falha o ranking inteiro).
  const metricsResults = await Promise.allSettled(
    bancas.map((b) => {
      const cleanUrl = normalizeBancaUrlAbsolute(b.url);
      if (!cleanUrl) return Promise.resolve(null);
      return fetchDashboardMetrics(cleanUrl, date, date);
    })
  );

  const rows: BancaXAdsRankingRow[] = bancas.map((b, idx) => {
    const bancaId = String(b.id);
    const spend = Number(liveAds.spendByBanca.get(bancaId)) || 0;
    const activeCampaigns = Number(liveAds.campaignsByBanca.get(bancaId)) || 0;

    const metricsR = metricsResults[idx];
    const metrics =
      metricsR.status === 'fulfilled' && metricsR.value
        ? metricsR.value
        : null;

    const totalDeposited = Number(metrics?.total_deposited) || 0;
    const totalLeads = Number(metrics?.total_leads) || 0;
    const totalBets = Number(metrics?.total_bets) || 0;
    const totalPrizes = Number(metrics?.total_prizes) || 0;
    const awardedCount = Number(metrics?.awarded_clients_count) || 0;
    const activeLeads = Number(metrics?.active_leads) || 0;

    const ads: BancaXAdsRankingRowAds = {
      spend,
      active_campaigns: activeCampaigns,
      currency: 'BRL',
    };

    const banca: BancaXAdsRankingRowBanca = {
      total_leads: totalLeads,
      total_deposited: totalDeposited,
      total_bets: totalBets,
      total_prizes: totalPrizes,
      awarded_clients_count: awardedCount,
      active_leads: activeLeads,
      conversion_rate: Number(metrics?.conversion_rate) || 0,
      ltv_avg: Number(metrics?.ltv_avg) || 0,
      net_profit: Number(metrics?.net_profit) || 0,
      available: metrics != null,
    };

    const conciliacao = computeConciliacao(spend, totalDeposited, awardedCount, banca.available);

    return {
      rank: 0,
      banca_id: bancaId,
      banca_name: b.name || b.url || bancaId,
      banca_url: b.url || '',
      ads,
      banca,
      conciliacao,
    };
  });

  // Ordena por gasto desc; em empate, depositado desc.
  rows.sort((a, b) => {
    const ds = b.ads.spend - a.ads.spend;
    if (ds !== 0) return ds;
    return b.banca.total_deposited - a.banca.total_deposited;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const totals = rows.reduce<BancaXAdsRankingTotals>(
    (acc, r) => {
      acc.spend_total += r.ads.spend;
      acc.active_campaigns_total += r.ads.active_campaigns;
      acc.leads_total += r.banca.total_leads;
      acc.deposited_total += r.banca.total_deposited;
      acc.bets_total += r.banca.total_bets;
      acc.prizes_total += r.banca.total_prizes;
      acc.roi_total += r.conciliacao.roi_absoluto;
      acc.bancas_total += 1;
      if (!r.banca.available) acc.bancas_crm_indisponivel += 1;
      return acc;
    },
    {
      spend_total: 0,
      active_campaigns_total: 0,
      leads_total: 0,
      deposited_total: 0,
      bets_total: 0,
      prizes_total: 0,
      roi_total: 0,
      roas_medio: null,
      bancas_total: 0,
      bancas_crm_indisponivel: 0,
    }
  );
  totals.roas_medio = totals.spend_total > 0 ? totals.deposited_total / totals.spend_total : null;

  return { period: { date, tz }, rows, totals };
}
