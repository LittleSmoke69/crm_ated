/**
 * Ranking "Banca x ADS" — Conciliação.
 *
 * APENAS campanhas LIVE do Meta entram no ranking — mesma fonte que alimenta
 * o card «Métricas de Campanhas». Banca só aparece se tem ao menos 1 campanha
 * LIVE atribuída a ela. Nada de campanhas antigas / só em meta_campaigns.
 *
 *   1. Lista campanhas LIVE de cada Ad Account (Meta Marketing API).
 *   2. Pra cada campanha, resolve banca via `meta_campaigns` (vínculo do dropdown
 *      «Vincular banca»). Sem vínculo + integração de 1 banca → atribui a ela;
 *      sem vínculo + integração compartilhada → descarta.
 *   3. Agrupa por banca, soma spend e contagem. Ordena por spend desc.
 *
 *   - Spend SEMPRE do Meta Marketing API (zero histórico de banco).
 *   - Métricas operacionais: CRM `/api/crm/dashboard-metrics`.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  fetchDashboardMetrics,
  peekDashboardMetricsLastKnown,
  type ExternalMetricsShape,
} from '@/lib/services/dashboard/dono-banca';
import { consolidateActiveCampaignsSpendAllIntegrations } from '@/lib/services/meta-sync-service';
import { buildCampaignConsultorSummary, type CampaignConsultorSummary } from '@/lib/services/meta-campaign-consultors';
import { formatMetaCalendarDayYmd } from '@/lib/meta/metaAdsService';
import { metaVerboseLog } from '@/lib/utils/meta-debug-log';

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Timeout por banca para o `dashboard-metrics` da CRM no ranking.
 * O ranking espera TODAS as bancas (`Promise.allSettled`), então o tempo total ≈ banca mais lenta.
 * Em prod a função tem limite de execução (ex.: Netlify ~26s) → cap em 15s para caber no orçamento;
 * CRMs mais lentas caem no fallback de último valor conhecido (cache stale) abaixo.
 * Em dev não há limite de plataforma → 25s acomoda CRMs lentas-mas-vivas (ex.: LotoX ~22s)
 * já na primeira carga. Ajustável via env para tuning.
 */
const RANKING_CRM_TIMEOUT_MS = (() => {
  const raw = parseInt(String(process.env.RANKING_CRM_TIMEOUT_MS ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 3000 && raw <= 60000) return raw;
  return process.env.NODE_ENV === 'production' ? 15000 : 25000;
})();

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

export type BancaXAdsRankingCampaignConsultor = {
  id: string;
  email: string;
  full_name: string | null;
  total_deposited: number;
  whatsapp_group_name?: string | null;
  whatsapp_group_invite_url?: string | null;
  gerente_id?: string | null;
  gerente_name?: string | null;
  /** Gasto diário estimado configurado pelo gestor (BRL). */
  daily_spend_estimate?: number | null;
};

export type BancaXAdsRankingCampaignAttribution = {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  consultor_total_deposited: number;
  consultor_total_daily_spend_estimate: number;
  assigned_consultors: BancaXAdsRankingCampaignConsultor[];
};

export type BancaXAdsRankingGestorAttribution = {
  campaigns: BancaXAdsRankingCampaignAttribution[];
  /** Soma de consultor_total_deposited por campanha (mesma regra da Gestão de Tráfego). */
  total_deposited_via_gestor: number;
  /** Soma das estimativas diárias configuradas pelo gestor. */
  total_daily_spend_estimate: number;
  consultores_count: number;
};

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
  /** Consultores e grupos configurados pelo gestor (meta_campaign_consultors + dashboard-metrics). */
  gestor_attribution?: BancaXAdsRankingGestorAttribution | null;
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
  /** Quando dateFrom === dateTo (ou só um dos dois informado), `date` ecoa esse dia para retrocompatibilidade. */
  period: { date: string; date_from: string; date_to: string; tz: string };
  rows: BancaXAdsRankingRow[];
  totals: BancaXAdsRankingTotals;
};

export type BancaXAdsRankingOptions = {
  /** YYYY-MM-DD. Atalho para single-day. Default = hoje em `tz` quando `dateFrom`/`dateTo` ausentes. */
  date?: string | null;
  /** Início do range YYYY-MM-DD. Sobrepõe `date`. */
  dateFrom?: string | null;
  /** Fim do range YYYY-MM-DD. Sobrepõe `date`. */
  dateTo?: string | null;
  /** IANA timezone. Default America/Sao_Paulo. */
  tz?: string | null;
  /** Limite opcional para reduzir o nº de chamadas ao CRM externo durante teste. */
  limit?: number | null;
};

type CrmBancaRow = { id: string; name: string | null; url: string | null };

type MetaCampaignRecord = {
  campaign_id: string;
  banca_id: string;
  banca_name: string;
  campaign_name: string | null;
};

/**
 * Snapshot completo de `meta_campaigns` com o nome da banca resolvido. Sem filtro
 * de status (vínculos manuais do dropdown criam rows com effective_status NULL).
 * Pagina porque o Supabase limita a 1000 rows por default; ordena por updated_at DESC
 * pra que duplicatas raras com mesmo campaign_id resolvam pela linha mais recente.
 */
async function fetchAllMetaCampaignsWithBanca(): Promise<MetaCampaignRecord[]> {
  const rawRows: Array<{ campaign_id: string; banca_id: string; name: string | null }> = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, banca_id, name, updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.warn('[banca-x-ads-ranking] meta_campaigns lookup error:', error.message);
      return [];
    }
    const rows = data ?? [];
    rawRows.push(
      ...(rows as Array<{ campaign_id: string; banca_id: string; name: string | null }>)
    );
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const seen = new Set<string>();
  const unique: typeof rawRows = [];
  for (const r of rawRows) {
    const cid = String(r.campaign_id ?? '').trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    unique.push(r);
  }

  const bancaIds = Array.from(new Set(unique.map((r) => String(r.banca_id ?? '').trim()).filter(Boolean)));
  const bancaNameById = new Map<string, string>();
  if (bancaIds.length > 0) {
    const { data: bancasData, error: bancasErr } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', bancaIds);
    if (bancasErr) {
      console.warn('[banca-x-ads-ranking] crm_bancas lookup error:', bancasErr.message);
    }
    for (const b of bancasData ?? []) {
      const id = String((b as { id: string }).id);
      const name = (b as { name?: string | null }).name;
      const url = (b as { url?: string | null }).url;
      bancaNameById.set(id, name || url || id);
    }
  }

  return unique.map((r) => ({
    campaign_id: String(r.campaign_id).trim(),
    banca_id: String(r.banca_id).trim(),
    banca_name: bancaNameById.get(String(r.banca_id).trim()) || String(r.banca_id).trim(),
    campaign_name: r.name ?? null,
  }));
}

type LiveAdsAggregate = {
  spendByBanca: Map<string, number>;
  campaignsByBanca: Map<string, number>;
  bancasWithActiveAds: Set<string>;
  campaignsByBancaDetail: Map<
    string,
    Array<{ campaign_id: string; campaign_name: string | null; spend: number }>
  >;
};

/**
 * Fluxo do ranking — APENAS campanhas LIVE entram, igual ao «Métricas de Campanhas».
 * meta_campaigns serve só pra resolver banca via vínculo do dropdown.
 *
 *   1. Meta LIVE retorna todas as campanhas atuais nas Ad Accounts das integrações.
 *   2. Pra cada campanha: lookup em `meta_campaigns` (sem filtro de status).
 *      - Vinculada → atribui à banca do vínculo.
 *      - Sem vínculo + integração 1-banca → atribui (fallback).
 *      - Sem vínculo + integração compartilhada → descarta (não chuta).
 */
async function fetchLiveAdsForRange(
  dateFrom: string,
  dateTo: string,
  tz: string
): Promise<LiveAdsAggregate> {
  // 1) Lookup de atribuição: campaign_id → banca via meta_campaigns.
  const dbCampaigns = await fetchAllMetaCampaignsWithBanca();
  const campaignToBanca = new Map<string, { banca_id: string; banca_name: string; campaign_name: string | null }>();
  for (const c of dbCampaigns) {
    if (!campaignToBanca.has(c.campaign_id)) {
      campaignToBanca.set(c.campaign_id, {
        banca_id: c.banca_id,
        banca_name: c.banca_name,
        campaign_name: c.campaign_name,
      });
    }
  }
  const bancaNameById = new Map<string, string>();
  for (const c of dbCampaigns) bancaNameById.set(c.banca_id, c.banca_name);

  // 2) Spend LIVE — sem filtro de delivery_info (pausadas com spend entram).
  const report = await consolidateActiveCampaignsSpendAllIntegrations({
    timeRange: { since: dateFrom, until: dateTo },
    timeIncrement: 1,
    calendarTimeZone: tz,
    includeInactiveCampaigns: true,
    // Ranking só usa spend por campanha; pular billing corta chamadas Meta lentas (getAccountFinance/activities).
    skipBilling: true,
  });

  metaVerboseLog('[banca-x-ads-ranking] DEBUG integrations', {
    by_integration: report.by_integration.map((s) => ({
      integration_id: s.integration_id,
      banca_ids_linked: s.banca_ids,
      campaigns_count: s.campaigns.length,
      total_spend: s.total_spend,
      error: s.error ?? null,
    })),
  });

  // 3) Itera SÓ campanhas LIVE. Cada uma vira 1 linha do ranking.
  const spendByBanca = new Map<string, number>();
  const campaignsByBanca = new Map<string, number>();
  const bancasWithActiveAds = new Set<string>();

  const trace = new Map<
    string,
    {
      banca_name: string;
      campaigns: Array<{
        campaign_id: string;
        campaign_name: string | null;
        spend: number;
        source: 'db_vinculated' | 'live_single_banca';
      }>;
    }
  >();

  let skippedSharedNoLink = 0;
  for (const c of report.campaigns) {
    const cid = String(c.id).trim();
    const spend = Number(c.spend) || 0;
    const dbMatch = campaignToBanca.get(cid);

    let bancaId: string | undefined;
    let bancaName = '';
    let source: 'db_vinculated' | 'live_single_banca' = 'db_vinculated';
    if (dbMatch) {
      bancaId = dbMatch.banca_id;
      bancaName = dbMatch.banca_name;
    } else if (c.banca_ids.length === 1) {
      bancaId = c.banca_ids[0];
      bancaName = bancaNameById.get(bancaId) ?? '';
      source = 'live_single_banca';
    } else {
      skippedSharedNoLink++;
      continue;
    }

    bancasWithActiveAds.add(bancaId);
    spendByBanca.set(bancaId, (spendByBanca.get(bancaId) ?? 0) + spend);
    campaignsByBanca.set(bancaId, (campaignsByBanca.get(bancaId) ?? 0) + 1);

    if (!trace.has(bancaId)) trace.set(bancaId, { banca_name: bancaName, campaigns: [] });
    trace.get(bancaId)!.campaigns.push({
      campaign_id: cid,
      campaign_name: (c as { name?: string }).name ?? dbMatch?.campaign_name ?? null,
      spend,
      source,
    });
  }

  const liveMatchedInDb = report.campaigns.filter((c) => campaignToBanca.has(String(c.id).trim())).length;

  metaVerboseLog('[banca-x-ads-ranking] aggregate (LIVE-only)', {
    date_from: dateFrom,
    date_to: dateTo,
    tz,
    live_campaigns_total: report.campaigns.length,
    live_matched_in_db: liveMatchedInDb,
    live_via_single_banca_fallback: report.campaigns.length - liveMatchedInDb - skippedSharedNoLink,
    skipped_shared_no_link: skippedSharedNoLink,
    bancas_in_ranking: bancasWithActiveAds.size,
    db_vinculation_pool_total: dbCampaigns.length,
    integrations_ok: report.summary.integrations_ok,
    integrations_failed: report.summary.integrations_failed,
  });

  // Log explícito por-banca: nome, total de campanhas vinculadas, soma do spend Meta.
  const groupedForLog = Array.from(trace.entries())
    .map(([banca_id, info]) => ({
      banca_id,
      banca_name: info.banca_name,
      campaigns_count: info.campaigns.length,
      total_spend: info.campaigns.reduce((s, c) => s + c.spend, 0),
      campaigns: info.campaigns,
    }))
    .sort((a, b) => b.total_spend - a.total_spend);
  metaVerboseLog('[banca-x-ads-ranking] grouping by banca', { grouped: groupedForLog });

  const campaignsByBancaDetail = new Map<
    string,
    Array<{ campaign_id: string; campaign_name: string | null; spend: number }>
  >();
  for (const [bancaId, info] of trace.entries()) {
    campaignsByBancaDetail.set(bancaId, info.campaigns.map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      spend: c.spend,
    })));
  }

  return { spendByBanca, campaignsByBanca, bancasWithActiveAds, campaignsByBancaDetail };
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

async function fetchGerenteInfoByConsultorId(
  consultorIds: string[]
): Promise<Map<string, { gerente_id: string | null; gerente_name: string | null }>> {
  const result = new Map<string, { gerente_id: string | null; gerente_name: string | null }>();
  if (!consultorIds.length) return result;

  const { data: consultorProfiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, enroller')
    .in('id', consultorIds);

  const enrollerIds = Array.from(
    new Set(
      (consultorProfiles || [])
        .map((p: { enroller?: string | null }) => p.enroller)
        .filter((id): id is string => Boolean(id))
    )
  );

  const gerenteById = new Map<string, { full_name: string | null; email: string }>();
  if (enrollerIds.length) {
    const { data: gerenteProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', enrollerIds);
    (gerenteProfiles || []).forEach((g: { id: string; full_name: string | null; email: string }) => {
      gerenteById.set(g.id, { full_name: g.full_name, email: g.email });
    });
  }

  (consultorProfiles || []).forEach((p: { id: string; enroller?: string | null }) => {
    const gerenteId = p.enroller?.trim() || null;
    const gerente = gerenteId ? gerenteById.get(gerenteId) : null;
    result.set(p.id, {
      gerente_id: gerenteId,
      gerente_name: gerente ? gerente.full_name || gerente.email || null : null,
    });
  });

  return result;
}

async function buildGestorAttributionForBanca(
  bancaId: string,
  campaigns: Array<{ campaign_id: string; campaign_name: string | null; spend: number }>,
  dateFrom: string,
  dateTo: string
): Promise<BancaXAdsRankingGestorAttribution | null> {
  if (!bancaId || !campaigns.length) return null;
  const campaignIds = campaigns.map((c) => c.campaign_id).filter(Boolean);
  if (!campaignIds.length) return null;

  try {
    const summaryByCampaign = await buildCampaignConsultorSummary(bancaId, campaignIds, dateFrom, dateTo);
    const spendByCampaignId = new Map(campaigns.map((c) => [c.campaign_id, c.spend]));
    const nameByCampaignId = new Map(campaigns.map((c) => [c.campaign_id, c.campaign_name]));

    const attributedCampaigns: BancaXAdsRankingCampaignAttribution[] = [];
    const consultorIds = new Set<string>();
    const campaignDrafts: Array<{
      campaignId: string;
      summary: CampaignConsultorSummary;
    }> = [];

    for (const campaignId of campaignIds) {
      const summary = summaryByCampaign.get(campaignId);
      const assigned = summary?.assigned_consultors ?? [];
      if (!assigned.length || !summary) continue;
      assigned.forEach((c) => consultorIds.add(c.id));
      campaignDrafts.push({ campaignId, summary });
    }

    const gerenteByConsultorId = await fetchGerenteInfoByConsultorId(Array.from(consultorIds));

    for (const { campaignId, summary } of campaignDrafts) {
      const assigned = summary.assigned_consultors ?? [];
      const mappedConsultors = assigned.map((c) => {
        const gerente = gerenteByConsultorId.get(c.id);
        return {
          id: c.id,
          email: c.email,
          full_name: c.full_name,
          total_deposited: Number(c.total_deposited) || 0,
          whatsapp_group_name: c.whatsapp_group_name ?? null,
          whatsapp_group_invite_url: c.whatsapp_group_invite_url ?? null,
          gerente_id: gerente?.gerente_id ?? null,
          gerente_name: gerente?.gerente_name ?? null,
          daily_spend_estimate:
            c.daily_spend_estimate != null ? Number(c.daily_spend_estimate) || 0 : null,
        };
      });
      const consultor_total_daily_spend_estimate = mappedConsultors.reduce(
        (sum, c) => sum + (Number(c.daily_spend_estimate) || 0),
        0
      );
      attributedCampaigns.push({
        campaign_id: campaignId,
        campaign_name: nameByCampaignId.get(campaignId) ?? null,
        spend: Number(spendByCampaignId.get(campaignId)) || 0,
        consultor_total_deposited: Number(summary.consultor_total_deposited) || 0,
        consultor_total_daily_spend_estimate,
        assigned_consultors: mappedConsultors,
      });
    }

    if (!attributedCampaigns.length) return null;

    const total_deposited_via_gestor = attributedCampaigns.reduce(
      (sum, c) => sum + (c.consultor_total_deposited || 0),
      0
    );
    const total_daily_spend_estimate = attributedCampaigns.reduce(
      (sum, c) => sum + (c.consultor_total_daily_spend_estimate || 0),
      0
    );

    return {
      campaigns: attributedCampaigns.sort((a, b) => b.spend - a.spend),
      total_deposited_via_gestor,
      total_daily_spend_estimate,
      consultores_count: consultorIds.size,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[banca-x-ads-ranking] gestor attribution error:', message, { bancaId });
    return null;
  }
}

/** Monta o ranking só com bancas que têm ads ativos no período (campanhas com delivery_info=active). */
export async function getBancaXAdsRanking(opts: BancaXAdsRankingOptions = {}): Promise<BancaXAdsRankingResult> {
  const tz = (opts.tz && opts.tz.trim()) || DEFAULT_TZ;
  const explicitFrom = (opts.dateFrom && opts.dateFrom.trim()) || null;
  const explicitTo = (opts.dateTo && opts.dateTo.trim()) || null;
  const singleShortcut = (opts.date && opts.date.trim()) || null;
  /**
   * Resolução: range explícito > single `date` legado > hoje no fuso.
   * Se só um dos limites veio, ele é usado para os dois (range degenerado de 1 dia).
   */
  let dateFrom: string;
  let dateTo: string;
  if (explicitFrom || explicitTo) {
    dateFrom = explicitFrom || explicitTo || formatMetaCalendarDayYmd(tz);
    dateTo = explicitTo || explicitFrom || dateFrom;
  } else if (singleShortcut) {
    dateFrom = singleShortcut;
    dateTo = singleShortcut;
  } else {
    const today = formatMetaCalendarDayYmd(tz);
    dateFrom = today;
    dateTo = today;
  }
  if (dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  /**
   * Pagina crm_bancas porque o default do Supabase é 1000 rows. Sem isto, sistemas
   * com >1000 bancas perderiam algumas e elas «sumiriam» do ranking mesmo tendo
   * spend — fica registrado no log abaixo se algum banca_id de spend não veio.
   */
  const allBancasRaw: CrmBancaRow[] = [];
  {
    const pageSize = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .order('name', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Erro ao buscar bancas: ${error.message}`);
      const rows = (data ?? []) as CrmBancaRow[];
      allBancasRaw.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  const liveAds = await fetchLiveAdsForRange(dateFrom, dateTo, tz);

  const totalCrmBancas = allBancasRaw.length;
  const crmBancaIds = new Set(allBancasRaw.map((b) => String(b.id)));

  // Bancas com spend que não existem em crm_bancas (orphans — indicam dados inconsistentes).
  const orphanBancaIds: string[] = [];
  for (const bid of liveAds.bancasWithActiveAds) {
    if (!crmBancaIds.has(String(bid))) orphanBancaIds.push(String(bid));
  }

  // Bancas filtradas por "sua banca" (placeholder do produto).
  const placeholderFiltered: Array<{ id: string; name: string | null }> = [];
  let bancas = allBancasRaw.filter((b) => {
    const name = String(b.name || '').trim().toLowerCase();
    if (name === 'sua banca') {
      if (liveAds.bancasWithActiveAds.has(String(b.id))) {
        placeholderFiltered.push({ id: String(b.id), name: b.name });
      }
      return false;
    }
    return liveAds.bancasWithActiveAds.has(String(b.id));
  });

  metaVerboseLog('[banca-x-ads-ranking] filter pipeline', {
    date_from: dateFrom,
    date_to: dateTo,
    crm_bancas_total: totalCrmBancas,
    bancas_in_ranking_total: liveAds.bancasWithActiveAds.size,
    bancas_in_ranking_ids: Array.from(liveAds.bancasWithActiveAds),
    orphan_count: orphanBancaIds.length,
    orphan_banca_ids_no_crm_row: orphanBancaIds,
    placeholder_filtered_count: placeholderFiltered.length,
    placeholder_filtered: placeholderFiltered,
    after_filter_count: bancas.length,
    after_filter_bancas: bancas.map((b) => ({ id: String(b.id), name: b.name })),
  });

  if (Number.isFinite(opts.limit as number) && (opts.limit as number) > 0) {
    bancas = bancas.slice(0, opts.limit as number);
  }

  // Chama dashboard-metrics em paralelo por banca (não falha o ranking inteiro).
  const cleanUrls = bancas.map((b) => normalizeBancaUrlAbsolute(b.url));
  const metricsResults = await Promise.allSettled(
    bancas.map((b, idx) => {
      const cleanUrl = cleanUrls[idx];
      if (!cleanUrl) return Promise.resolve(null);
      // Timeout curto por banca: evita que uma CRM lenta segure o ranking inteiro (allSettled).
      return fetchDashboardMetrics(cleanUrl, dateFrom, dateTo, AbortSignal.timeout(RANKING_CRM_TIMEOUT_MS));
    })
  );

  /**
   * Resolução final por banca: fetch OK → valor fresco; falha/timeout → último valor conhecido
   * do cache (a requisição compartilhada que estourou o timeout termina em background e aquece
   * o cache — montagens seguintes recuperam o valor aqui em vez de "CRM indisponível").
   */
  const crmFailures: Array<{ banca_id: string; banca_name: string | null; error: string }> = [];
  const staleRecoveries: Array<{ banca_id: string; banca_name: string | null }> = [];
  const metricsByIdx: Array<ExternalMetricsShape | null> = metricsResults.map((r, idx) => {
    if (r.status === 'fulfilled' && r.value) return r.value;
    const b = bancas[idx];
    const cleanUrl = cleanUrls[idx];
    const lastKnown = cleanUrl ? peekDashboardMetricsLastKnown(cleanUrl, dateFrom, dateTo) : null;
    if (lastKnown) {
      staleRecoveries.push({ banca_id: String(b.id), banca_name: b.name });
      return lastKnown;
    }
    crmFailures.push({
      banca_id: String(b.id),
      banca_name: b.name,
      error:
        r.status === 'rejected'
          ? r.reason instanceof Error
            ? r.reason.message
            : String(r.reason)
          : 'fetchDashboardMetrics returned null (URL inválida ou CRM offline)',
    });
    return null;
  });
  if (staleRecoveries.length > 0) {
    console.log('[banca-x-ads-ranking] crm dashboard-metrics: usando último valor conhecido (stale)', {
      total: staleRecoveries.length,
      bancas: staleRecoveries,
    });
  }
  if (crmFailures.length > 0) {
    console.warn('[banca-x-ads-ranking] crm dashboard-metrics failures', {
      total: crmFailures.length,
      failures: crmFailures.map((f) => ({ banca_id: f.banca_id, banca_name: f.banca_name, error: f.error })),
    });
  }

  const gestorAttributionResults = await Promise.allSettled(
    bancas.map((b) => {
      const bancaId = String(b.id);
      const campaigns = liveAds.campaignsByBancaDetail.get(bancaId) ?? [];
      return buildGestorAttributionForBanca(bancaId, campaigns, dateFrom, dateTo);
    })
  );

  const rows: BancaXAdsRankingRow[] = bancas.map((b, idx) => {
    const bancaId = String(b.id);
    const spend = Number(liveAds.spendByBanca.get(bancaId)) || 0;
    const activeCampaigns = Number(liveAds.campaignsByBanca.get(bancaId)) || 0;

    const metrics = metricsByIdx[idx];

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
    const gestorResult = gestorAttributionResults[idx];
    const gestor_attribution =
      gestorResult.status === 'fulfilled' ? gestorResult.value : null;

    return {
      rank: 0,
      banca_id: bancaId,
      banca_name: b.name || b.url || bancaId,
      banca_url: b.url || '',
      ads,
      banca,
      conciliacao,
      gestor_attribution,
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

  /** Output final do ranking — confere com o que aparece no front. */
  metaVerboseLog('[banca-x-ads-ranking] FINAL output', {
    date_from: dateFrom,
    date_to: dateTo,
    rows_count: rows.length,
    rows: rows.map((r) => ({
      rank: r.rank,
      banca_id: r.banca_id,
      banca_name: r.banca_name,
      spend: r.ads.spend,
      active_campaigns: r.ads.active_campaigns,
      crm_available: r.banca.available,
    })),
    totals,
  });

  return {
    period: { date: dateFrom === dateTo ? dateFrom : dateTo, date_from: dateFrom, date_to: dateTo, tz },
    rows,
    totals,
  };
}
