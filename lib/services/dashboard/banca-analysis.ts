/**
 * Análise da Banca — consolida, para UMA banca e um período:
 *  - Gasto de ADS (Meta): soma de meta_insights_daily (mesma fonte do ranking).
 *  - Métricas recorrentes / LTV: cohort-real-players (faturamento, LTV, recorrência…).
 *  - Métricas de 1º depósito: CRM dashboard-metrics.
 *  - Quebra por consultor: ADS + Faturamento + LTV de cada consultor (slide do card).
 *
 * Reusado na Gestão de Banca, na Integração Meta Ads (admin) e na Gestão de Tráfego.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  fetchCohortRealPlayers,
  fetchDashboardMetrics,
  type CohortPlayer,
} from '@/lib/services/dashboard/dono-banca';
import { getMetaInsightsAggregated, listMetaIntegrationsForBanca } from '@/lib/services/meta-sync-service';
import { fetchLiveAdsForRange, type LiveAdsAggregate } from '@/lib/services/banca-x-ads-ranking';

const LIVE_ADS_TTL_MS = 60_000;
const liveAdsCache = new Map<string, { value: Promise<LiveAdsAggregate | null>; at: number }>();

/**
 * Spend LIVE por banca — MESMA fonte do Ranking Diário (Meta Graph API ao vivo).
 * Cacheado por (período) por 60s para que vários cards compartilhem 1 chamada.
 */
export function getLiveAdsByRange(dateFrom: string, dateTo: string): Promise<LiveAdsAggregate | null> {
  const tz = 'America/Sao_Paulo';
  const key = `${dateFrom}|${dateTo}|${tz}`;
  const now = Date.now();
  const cached = liveAdsCache.get(key);
  if (cached && now - cached.at < LIVE_ADS_TTL_MS) return cached.value;
  const value = fetchLiveAdsForRange(dateFrom, dateTo, tz).catch(() => null);
  liveAdsCache.set(key, { value, at: now });
  return value;
}

export interface BancaAnalysisConsultant {
  consultant_email: string;
  consultant_name: string;
  ads: number;
  faturamento: number;
  ltv: number;
  players: number;
  players_that_deposited: number;
}

/** Consultor atribuído às campanhas de ADS da banca (mesma atribuição do Ranking). */
export interface BancaAnalysisAdsConsultant {
  consultant_email: string;
  consultant_name: string;
  ads: number;
}

export interface BancaAnalysis {
  ads_active: boolean;
  // Métricas principais (mapeamento confirmado)
  ads_spend: number; // Gasto de ADS (Meta)
  faturamento: number; // total_deposited_in_window
  ltv: number; // total_ltv_in_window
  ltv_pct: number; // ltv / faturamento * 100
  custo_por_lead: number; // ads_spend / total_cadastros
  total_depositos: number; // total_deposits_count_in_window
  depositos_recorrentes: number; // players_with_ltv
  total_cadastros: number; // cohort_size
  total_premio: number; // dashboard-metrics total_prizes (1º depósito)
  total_gerados: number; // lucro = faturamento - prêmios
  // Submétricas (cohort)
  cohort: {
    cohort_size: number;
    total_deposited_in_window: number;
    total_deposits_count_in_window: number;
    players_that_deposited: number;
    total_ltv_in_window: number;
    players_with_ltv: number;
    ltv_avg: number;
    deposit_buckets: { dep_1x: number; dep_2x: number; dep_3x: number; dep_4x_plus: number };
  } | null;
  // Métricas de 1º depósito (dashboard-metrics)
  first_deposit: {
    total_deposited: number;
    total_deposits_count: number;
    total_leads: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
    total_prizes: number;
  } | null;
  /** Consultores por cohort (geral). */
  consultants: BancaAnalysisConsultant[];
  /** Consultores atribuídos às campanhas de ADS (fonte do Ranking). */
  ads_consultants: BancaAnalysisAdsConsultant[];
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Constrói mapa profileId -> spend (BRL bruto) das campanhas atribuídas, no período. */
async function buildConsultorAdsSpendMap(
  bancaId: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<Map<string, number>> {
  // 1) Atribuição: profileId -> Set(campaignId)
  const consultorCampaigns = new Map<string, Set<string>>();
  const addCampaign = (profileId: string, campaignId: string) => {
    if (!profileId || !campaignId) return;
    let set = consultorCampaigns.get(profileId);
    if (!set) {
      set = new Set<string>();
      consultorCampaigns.set(profileId, set);
    }
    set.add(campaignId);
  };

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
        const ids = Array.isArray(r.ads_attribution_consultor_ids) ? r.ads_attribution_consultor_ids : [];
        let any = false;
        for (const x of ids) {
          const id = String(x ?? '').trim();
          if (id) {
            addCampaign(id, cp);
            any = true;
          }
        }
        if (!any) {
          const leg = String(r.ads_attribution_consultor_id ?? '').trim();
          if (leg) addCampaign(leg, cp);
        }
      }
    }
  } catch {
    /* coluna pode não existir em bases antigas */
  }

  const { data: links } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id, consultor_id')
    .eq('banca_id', bancaId);
  for (const row of links ?? []) {
    addCampaign(String((row as any).consultor_id ?? '').trim(), String((row as any).campaign_id ?? '').trim());
  }

  // 2) Spend por campanha no período
  const allCampaignIds = new Set<string>();
  for (const set of consultorCampaigns.values()) for (const c of set) allCampaignIds.add(c);
  const spendByCampaign = new Map<string, number>();
  if (allCampaignIds.size > 0) {
    let query = supabaseServiceRole
      .from('meta_insights_daily')
      .select('campaign_id, spend')
      .eq('banca_id', bancaId)
      .in('campaign_id', Array.from(allCampaignIds));
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    const { data } = await query;
    for (const row of data ?? []) {
      const c = String((row as any).campaign_id ?? '');
      spendByCampaign.set(c, (spendByCampaign.get(c) || 0) + (Number((row as any).spend) || 0));
    }
  }

  // 3) profileId -> spend
  const spendByConsultor = new Map<string, number>();
  for (const [profileId, set] of consultorCampaigns) {
    let total = 0;
    for (const cp of set) total += spendByCampaign.get(cp) || 0;
    spendByConsultor.set(profileId, roundMoney(total));
  }
  return spendByConsultor;
}

/**
 * Consultores atribuídos às campanhas de ADS da banca (mesma atribuição do Ranking).
 * O valor de ADS por consultor usa o GASTO DIÁRIO ESTIMADO definido pelo gestor na
 * atribuição (daily_spend_estimate — mesmo do Ranking); se o consultor não tiver
 * estimativa, cai para o gasto real sincronizado. Leve (não chama dashboard-metrics).
 */
async function buildAdsConsultants(
  bancaId: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<BancaAnalysisAdsConsultant[]> {
  const spendByConsultor = await buildConsultorAdsSpendMap(bancaId, dateFrom, dateTo);
  const profileIds = Array.from(spendByConsultor.keys());
  if (profileIds.length === 0) return [];

  // Gasto diário estimado por consultor (soma nas campanhas) — valor informado pelo gestor.
  const estByConsultor = new Map<string, number>();
  const { data: estRows } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('consultor_id, daily_spend_estimate')
    .eq('banca_id', bancaId)
    .in('consultor_id', profileIds);
  for (const r of estRows ?? []) {
    const id = String((r as any).consultor_id ?? '').trim();
    if (!id) continue;
    estByConsultor.set(id, (estByConsultor.get(id) || 0) + (Number((r as any).daily_spend_estimate) || 0));
  }

  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name')
    .in('id', profileIds);

  const out: BancaAnalysisAdsConsultant[] = [];
  for (const p of profiles ?? []) {
    const id = String((p as any).id);
    const email = String((p as any).email ?? '').trim();
    if (!email) continue;
    const est = estByConsultor.get(id) || 0;
    out.push({
      consultant_email: email,
      consultant_name: (p as any).full_name || email,
      // Prioriza a estimativa do gestor; sem estimativa, usa o gasto real.
      ads: roundMoney(est > 0 ? est : spendByConsultor.get(id) || 0),
    });
  }
  return out.sort((a, b) => b.ads - a.ads || a.consultant_name.localeCompare(b.consultant_name));
}

/** Agrega o cohort por consultor (faturamento + LTV) e cruza com o ADS por consultor. */
async function buildConsultants(
  bancaId: string,
  players: CohortPlayer[],
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<BancaAnalysisConsultant[]> {
  // Agrega cohort por email do consultor (id do CRM != profiles.id).
  const byEmail = new Map<string, BancaAnalysisConsultant>();
  for (const p of players) {
    const email = (p.consultant_email || '').trim();
    const key = (email || p.consultant_name || `id:${p.consultant_id ?? '—'}`).toLowerCase();
    const cur = byEmail.get(key) || {
      consultant_email: email,
      consultant_name: p.consultant_name || email || 'Consultor',
      ads: 0,
      faturamento: 0,
      ltv: 0,
      players: 0,
      players_that_deposited: 0,
    };
    cur.faturamento += Number(p.deposited_in_window) || 0;
    cur.ltv += Number(p.ltv_in_window) || 0;
    cur.players += 1;
    if ((Number(p.deposited_in_window) || 0) > 0) cur.players_that_deposited += 1;
    byEmail.set(key, cur);
  }

  // ADS por consultor: mapeia email do CRM -> profiles.id -> spend atribuído.
  const emails = Array.from(byEmail.values())
    .map((c) => c.consultant_email)
    .filter(Boolean);
  if (emails.length > 0) {
    const [{ data: profiles }, spendByConsultor] = await Promise.all([
      supabaseServiceRole.from('profiles').select('id, email').in('email', emails),
      buildConsultorAdsSpendMap(bancaId, dateFrom, dateTo),
    ]);
    const profileIdByEmail = new Map<string, string>();
    for (const pr of profiles ?? []) {
      const em = String((pr as any).email ?? '').trim().toLowerCase();
      if (em) profileIdByEmail.set(em, String((pr as any).id));
    }
    for (const c of byEmail.values()) {
      const profileId = profileIdByEmail.get(c.consultant_email.trim().toLowerCase());
      if (profileId) c.ads = spendByConsultor.get(profileId) || 0;
    }
  }

  return Array.from(byEmail.values())
    .map((c) => ({
      ...c,
      faturamento: roundMoney(c.faturamento),
      ltv: roundMoney(c.ltv),
    }))
    .sort((a, b) => b.ltv - a.ltv || b.faturamento - a.faturamento);
}

export async function getBancaAnalysis(params: {
  bancaId: string;
  bancaUrl: string;
  dateFrom: string | null | undefined;
  dateTo: string | null | undefined;
  signal?: AbortSignal;
}): Promise<BancaAnalysis> {
  const { bancaId, bancaUrl, dateFrom, dateTo, signal } = params;

  // Spend LIVE (mesma fonte do Ranking Diário) quando há período; senão, sincronizado.
  const liveAds = dateFrom && dateTo ? await getLiveAdsByRange(dateFrom, dateTo) : null;

  const [cohortResult, dmRaw, insights, integrations] = await Promise.all([
    fetchCohortRealPlayers(bancaUrl, dateFrom, dateTo, signal).catch(() => null),
    fetchDashboardMetrics(bancaUrl, dateFrom, dateTo, signal).catch(() => null),
    liveAds ? Promise.resolve(null) : getMetaInsightsAggregated(bancaId, dateFrom, dateTo, false).catch(() => null),
    listMetaIntegrationsForBanca(bancaId).catch(() => []),
  ]);

  // Prioriza o spend LIVE do ranking; cai para o sincronizado se indisponível.
  const liveSpend = liveAds?.spendByBanca?.get(bancaId);
  const adsSpend = roundMoney(liveSpend != null ? liveSpend : insights?.spend ?? 0);
  const adsActive =
    Boolean(liveAds?.bancasWithActiveAds?.has(bancaId)) ||
    (integrations ?? []).some((i) => i.is_active) ||
    adsSpend > 0;

  const ct = cohortResult?.totals ?? null;
  // Faturamento = total_deposited_in_window do endpoint /cohort-real-players.
  const faturamento = roundMoney(ct?.total_deposited_in_window ?? 0);
  const ltv = roundMoney(ct?.total_ltv_in_window ?? 0);
  const totalPremio = roundMoney(dmRaw?.total_prizes ?? 0);
  const totalCadastros = ct?.cohort_size ?? 0;
  // Custo por lead = gasto de ADS ÷ total de cadastro no período.
  const custoPorLead = totalCadastros > 0 ? roundMoney(adsSpend / totalCadastros) : 0;

  const [consultants, ads_consultants] = await Promise.all([
    cohortResult?.data?.length ? buildConsultants(bancaId, cohortResult.data, dateFrom, dateTo) : Promise.resolve([]),
    buildAdsConsultants(bancaId, dateFrom, dateTo),
  ]);

  return {
    ads_active: adsActive,
    ads_spend: adsSpend,
    faturamento,
    ltv,
    ltv_pct: faturamento > 0 ? roundMoney((ltv / faturamento) * 100) : 0,
    custo_por_lead: custoPorLead,
    total_depositos: ct?.total_deposits_count_in_window ?? 0,
    depositos_recorrentes: ct?.players_with_ltv ?? 0,
    total_cadastros: totalCadastros,
    total_premio: totalPremio,
    total_gerados: roundMoney(faturamento - totalPremio),
    cohort: ct
      ? {
          cohort_size: ct.cohort_size,
          total_deposited_in_window: roundMoney(ct.total_deposited_in_window),
          total_deposits_count_in_window: ct.total_deposits_count_in_window,
          players_that_deposited: ct.players_that_deposited,
          total_ltv_in_window: roundMoney(ct.total_ltv_in_window),
          players_with_ltv: ct.players_with_ltv,
          ltv_avg: roundMoney(ct.ltv_avg),
          deposit_buckets: ct.deposit_buckets,
        }
      : null,
    first_deposit: dmRaw
      ? {
          total_deposited: roundMoney(dmRaw.total_deposited ?? 0),
          total_deposits_count: Number(dmRaw.total_depositos_count) || 0,
          total_leads: Number(dmRaw.total_leads) || 0,
          active_leads: Number(dmRaw.active_leads) || 0,
          conversion_rate: Number(dmRaw.conversion_rate) || 0,
          ltv_avg: roundMoney(dmRaw.ltv_avg ?? 0),
          net_profit: roundMoney(dmRaw.net_profit ?? 0),
          total_prizes: totalPremio,
        }
      : null,
    consultants,
    ads_consultants,
  };
}
