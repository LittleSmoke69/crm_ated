import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const META_OVERVIEW_CAMPAIGNS_FIELDS = 'banca_id, campaign_id, name, status, effective_status, updated_at, campaign_kind';
const META_OVERVIEW_INSIGHTS_FIELDS =
  'banca_id, campaign_id, reach, impressions, clicks, leads, spend, raw_cost_per_action_type';

/** Acumula cost_per_action_type (JSONB por linha) para debug nos logs — valores somados por action_type no período. */
function accumulateCostPerActionType(into: Map<string, number>, raw: unknown): void {
  let source: unknown = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  if (!source || !Array.isArray(source)) return;
  for (const item of source as { action_type?: string; value?: string }[]) {
    const at = item?.action_type != null ? String(item.action_type) : '';
    if (!at) continue;
    const n = parseFloat(String(item.value ?? '0')) || 0;
    into.set(at, (into.get(at) ?? 0) + n);
  }
}

function costPerActionMapForLog(m: Map<string, number>, limit = 20): Record<string, number> {
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

/** Linha de `meta_integration_configs` usada no join com `meta_integration_bancas`. */
type MetaIntegrationConfigRow = {
  id: string;
  is_active: boolean;
  base_url: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
};

type OverviewRow = {
  banca_id: string;
  banca_name: string;
  banca_url: string;
  configured: boolean;
  is_active: boolean;
  base_url: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  metrics: {
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    spend: number;
    insights_rows: number;
  };
  campaigns: {
    total: number;
    active: number;
    sample: Array<{
      campaign_id: string;
      name: string | null;
      status: string | null;
      effective_status: string | null;
      updated_at: string | null;
    }>;
  };
};

type KindSummaryBucket = {
  campaigns: number;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  insights_rows: number;
};

/**
 * GET /api/admin/meta/overview
 * Retorna visão geral de TODAS as bancas com:
 * - status da integração Meta
 * - métricas agregadas de insights
 * - contagem e amostra de campanhas sincronizadas
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const dateFrom = req.nextUrl.searchParams.get('date_from');
    const dateTo = req.nextUrl.searchParams.get('date_to');
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    let appliedDateFrom = dateFrom;
    let appliedDateTo = dateTo;

    const [bancasRes, linksRes, configsRes, campaignsResRaw, insightsResRaw, legacyRes] = await Promise.all([
      (() => {
        let q = supabaseServiceRole.from('crm_bancas').select('id, name, url').order('name', { ascending: true });
        if (bancaId) q = q.eq('id', bancaId);
        return q;
      })(),
      supabaseServiceRole
        .from('meta_integration_bancas')
        .select('banca_id, integration_id'),
      supabaseServiceRole
        .from('meta_integration_configs')
        .select('id, is_active, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, last_sync_at, last_sync_error, last_sync_date_preset'),
      (() => {
        let q = supabaseServiceRole
          .from('meta_campaigns')
          .select(META_OVERVIEW_CAMPAIGNS_FIELDS)
          .order('updated_at', { ascending: false });
        if (bancaId) q = q.eq('banca_id', bancaId);
        return q;
      })(),
      (() => {
        let query = supabaseServiceRole
          .from('meta_insights_daily')
          .select(META_OVERVIEW_INSIGHTS_FIELDS);
        if (bancaId) query = query.eq('banca_id', bancaId);
        if (dateFrom) query = query.gte('date', dateFrom);
        if (dateTo) query = query.lte('date', dateTo);
        return query;
      })(),
      supabaseServiceRole
        .from('meta_integrations')
        .select(
          'banca_id, is_active, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, last_sync_at, last_sync_error, last_sync_date_preset'
        ),
    ]);

    if (bancasRes.error) return errorResponse(`Erro ao buscar bancas: ${bancasRes.error.message}`, 500);
    if (linksRes.error) return errorResponse(`Erro ao buscar vínculos de integração: ${linksRes.error.message}`, 500);
    if (configsRes.error) return errorResponse(`Erro ao buscar integrações: ${configsRes.error.message}`, 500);
    if (campaignsResRaw.error) return errorResponse(`Erro ao buscar campanhas: ${campaignsResRaw.error.message}`, 500);
    if (insightsResRaw.error) return errorResponse(`Erro ao buscar insights: ${insightsResRaw.error.message}`, 500);
    // Tabela legada pode não existir em alguns ambientes — não falha a visão geral inteira.
    const legacyIntegrations = !legacyRes.error ? (legacyRes.data ?? []) : [];

    const bancas = bancasRes.data ?? [];
    const links = linksRes.data ?? [];
    const configs = configsRes.data ?? [];
    const campaigns = campaignsResRaw.data ?? [];
    let insights = insightsResRaw.data ?? [];

    // Fallback pragmático: se o filtro diário vier sem linhas, usa o último dia com dados até date_to.
    // Isso evita cards zerados quando a virada do dia ocorreu, mas o sync do dia ainda não rodou.
    if (
      insights.length === 0 &&
      dateFrom &&
      dateTo &&
      dateFrom === dateTo
    ) {
      let latestDateQuery = supabaseServiceRole
        .from('meta_insights_daily')
        .select('date')
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .limit(1);
      if (bancaId) latestDateQuery = latestDateQuery.eq('banca_id', bancaId);
      const latestDateRes = await latestDateQuery.maybeSingle();

      const fallbackDate =
        !latestDateRes.error && latestDateRes.data?.date
          ? String(latestDateRes.data.date)
          : null;

      if (fallbackDate && fallbackDate !== dateFrom) {
        let fallbackInsightsQuery = supabaseServiceRole
          .from('meta_insights_daily')
          .select(META_OVERVIEW_INSIGHTS_FIELDS)
          .gte('date', fallbackDate)
          .lte('date', fallbackDate);
        if (bancaId) fallbackInsightsQuery = fallbackInsightsQuery.eq('banca_id', bancaId);
        const fallbackInsightsRes = await fallbackInsightsQuery;

        if (!fallbackInsightsRes.error) {
          insights = fallbackInsightsRes.data ?? [];
          appliedDateFrom = fallbackDate;
          appliedDateTo = fallbackDate;
          console.log('[admin/meta/overview] fallback período sem insights no dia', {
            requested_date: dateFrom,
            applied_date: fallbackDate,
            insights_rows: insights.length,
          });
        }
      }
    }

    const firstInsight = insights[0] as Record<string, unknown> | undefined;
    const firstCampaign = campaigns[0] as Record<string, unknown> | undefined;
    console.log('[admin/meta/overview] DB meta_insights_daily', {
      rows: insights.length,
      fields: firstInsight ? Object.keys(firstInsight) : [],
      sample: firstInsight ?? null,
    });
    console.log('[admin/meta/overview] DB meta_campaigns', {
      rows: campaigns.length,
      fields: firstCampaign ? Object.keys(firstCampaign) : [],
      sample: firstCampaign ?? null,
      requested_fields: META_OVERVIEW_CAMPAIGNS_FIELDS,
      filters: { date_from: dateFrom ?? null, date_to: dateTo ?? null },
      applied_filters: { date_from: appliedDateFrom ?? null, date_to: appliedDateTo ?? null },
    });
    console.log('[admin/meta/overview] DB meta_insights_daily requested_fields', {
      requested_fields: META_OVERVIEW_INSIGHTS_FIELDS,
      filters: { date_from: dateFrom ?? null, date_to: dateTo ?? null },
      applied_filters: { date_from: appliedDateFrom ?? null, date_to: appliedDateTo ?? null },
    });

    const configById = new Map<string, MetaIntegrationConfigRow>(
      (configs as MetaIntegrationConfigRow[]).map((c) => [String(c.id), c])
    );
    const integrationByBanca = new Map<string, MetaIntegrationConfigRow>();
    for (const row of links as { banca_id: string; integration_id: string }[]) {
      const bancaKey = String(row.banca_id);
      const cfg = configById.get(String(row.integration_id));
      if (cfg) integrationByBanca.set(bancaKey, cfg);
    }

    /** Modelo antigo (por banca): usado quando ainda não há linha em meta_integration_bancas. */
    const legacyByBanca = new Map<string, MetaIntegrationConfigRow>();
    for (const row of legacyIntegrations as {
      banca_id: string;
      is_active?: boolean | null;
      base_url?: string | null;
      token_last4?: string | null;
      ad_account_id?: string | null;
      pixel_id?: string | null;
      default_campaign_id?: string | null;
      last_sync_at?: string | null;
      last_sync_error?: string | null;
      last_sync_date_preset?: string | null;
    }[]) {
      if (!row?.banca_id) continue;
      const bancaKey = String(row.banca_id);
      legacyByBanca.set(bancaKey, {
        id: '',
        is_active: row.is_active !== false,
        base_url: row.base_url ?? null,
        token_last4: row.token_last4 ?? null,
        ad_account_id: row.ad_account_id ?? null,
        pixel_id: row.pixel_id ?? null,
        default_campaign_id: row.default_campaign_id ?? null,
        last_sync_at: row.last_sync_at ?? null,
        last_sync_error: row.last_sync_error ?? null,
        last_sync_date_preset: row.last_sync_date_preset ?? null,
      });
    }

    const campaignsByBanca = new Map<string, OverviewRow['campaigns']>();
    for (const row of campaigns) {
      const bid = String((row as { banca_id: string }).banca_id);
      const current = campaignsByBanca.get(bid) ?? { total: 0, active: 0, sample: [] };
      current.total += 1;
      if ((row.effective_status ?? row.status) === 'ACTIVE') current.active += 1;
      if (current.sample.length < 5) {
        current.sample.push({
          campaign_id: row.campaign_id,
          name: row.name,
          status: row.status,
          effective_status: row.effective_status,
          updated_at: row.updated_at,
        });
      }
      campaignsByBanca.set(bid, current);
    }

    const metricsByBanca = new Map<string, OverviewRow['metrics']>();
    const campaignKindByBancaCampaign = new Map<string, 'normal' | 'bolao'>();
    const campaignKindByCampaignId = new Map<string, 'normal' | 'bolao'>();
    for (const row of campaigns as Array<{ banca_id: string; campaign_id: string; campaign_kind?: string | null }>) {
      const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
      const kind = String(row.campaign_kind || 'normal') === 'bolao' ? 'bolao' : 'normal';
      campaignKindByBancaCampaign.set(key, kind);
      const cid = String(row.campaign_id);
      const prev = campaignKindByCampaignId.get(cid);
      // Em caso de conflito, prioriza bolão.
      if (!prev || prev === 'normal') {
        campaignKindByCampaignId.set(cid, kind);
      }
    }

    const kindSummary: Record<'normal' | 'bolao', KindSummaryBucket> = {
      normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
      bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
    };
    for (const row of campaigns as Array<{ campaign_kind?: string | null }>) {
      const kind = String(row.campaign_kind || 'normal') === 'bolao' ? 'bolao' : 'normal';
      kindSummary[kind].campaigns += 1;
    }
    const costPerActionByBanca = new Map<string, Map<string, number>>();
    const globalCostPerAction = new Map<string, number>();

    let insightsWithoutKindMatch = 0;
    for (const row of insights) {
      const bid = String((row as { banca_id: string }).banca_id);
      const cid = String((row as { campaign_id?: string | null }).campaign_id ?? '');
      const exactKind = campaignKindByBancaCampaign.get(`${bid}:${cid}`);
      const kindByCampaign = campaignKindByCampaignId.get(cid);
      const kind = exactKind ?? kindByCampaign ?? 'normal';
      if (!exactKind && !kindByCampaign) insightsWithoutKindMatch += 1;
      const rawCpa = (row as { raw_cost_per_action_type?: unknown }).raw_cost_per_action_type;
      accumulateCostPerActionType(globalCostPerAction, rawCpa);
      let perBanca = costPerActionByBanca.get(bid);
      if (!perBanca) {
        perBanca = new Map<string, number>();
        costPerActionByBanca.set(bid, perBanca);
      }
      accumulateCostPerActionType(perBanca, rawCpa);

      const current = metricsByBanca.get(bid) ?? {
        reach: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        spend: 0,
        insights_rows: 0,
      };
      current.reach += Number(row.reach) || 0;
      current.impressions += Number(row.impressions) || 0;
      current.clicks += Number(row.clicks) || 0;
      current.leads += Number(row.leads) || 0;
      current.spend += Number(row.spend) || 0;
      current.insights_rows += 1;
      metricsByBanca.set(bid, current);

      if (cid) {
        kindSummary[kind].reach += Number(row.reach) || 0;
        kindSummary[kind].impressions += Number(row.impressions) || 0;
        kindSummary[kind].clicks += Number(row.clicks) || 0;
        kindSummary[kind].leads += Number(row.leads) || 0;
        kindSummary[kind].spend += Number(row.spend) || 0;
        kindSummary[kind].insights_rows += 1;
      }
    }

    const rows: OverviewRow[] = bancas.map((banca) => {
      const bancaKey = String(banca.id);
      const integration = integrationByBanca.get(bancaKey) ?? legacyByBanca.get(bancaKey);
      return {
        banca_id: banca.id,
        banca_name: banca.name || banca.url || banca.id,
        banca_url: banca.url || '',
        configured: Boolean(integration),
        is_active: integration?.is_active ?? false,
        base_url: integration?.base_url ?? null,
        // Retorna apenas os 4 últimos dígitos (sem máscara) para o client mascarar uma vez.
        token_last4: integration?.token_last4 ?? null,
        ad_account_id: integration?.ad_account_id ?? null,
        pixel_id: integration?.pixel_id ?? null,
        default_campaign_id: integration?.default_campaign_id ?? null,
        last_sync_at: integration?.last_sync_at ?? null,
        last_sync_error: integration?.last_sync_error ?? null,
        last_sync_date_preset: integration?.last_sync_date_preset ?? null,
        metrics: metricsByBanca.get(bancaKey) ?? {
          reach: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          spend: 0,
          insights_rows: 0,
        },
        campaigns: campaignsByBanca.get(bancaKey) ?? { total: 0, active: 0, sample: [] },
      };
    });

    const totalsOverview = rows.reduce(
      (acc, row) => {
        acc.total_reach += Number(row.metrics.reach) || 0;
        acc.total_impressions += Number(row.metrics.impressions) || 0;
        acc.total_clicks += Number(row.metrics.clicks) || 0;
        acc.total_spend += Number(row.metrics.spend) || 0;
        acc.total_leads += Number(row.metrics.leads) || 0;
        acc.insights_rows += Number(row.metrics.insights_rows) || 0;
        return acc;
      },
      {
        total_reach: 0,
        total_impressions: 0,
        total_clicks: 0,
        total_spend: 0,
        total_leads: 0,
        insights_rows: 0,
      }
    );
    const topContributors = rows
      .filter((row) => (Number(row.metrics.spend) || 0) > 0 || (Number(row.metrics.leads) || 0) > 0)
      .sort((a, b) => (Number(b.metrics.spend) || 0) - (Number(a.metrics.spend) || 0))
      .slice(0, 10)
      .map((row) => {
        const bid = String(row.banca_id);
        const cpaMap = costPerActionByBanca.get(bid);
        return {
          banca_id: row.banca_id,
          banca_name: row.banca_name,
          reach: Number(row.metrics.reach) || 0,
          impressions: Number(row.metrics.impressions) || 0,
          clicks: Number(row.metrics.clicks) || 0,
          leads: Number(row.metrics.leads) || 0,
          spend: Number(row.metrics.spend) || 0,
          insights_rows: Number(row.metrics.insights_rows) || 0,
          cost_per_action_type: cpaMap ? costPerActionMapForLog(cpaMap) : {},
        };
      });
    console.log('[admin/meta/overview] SOMA visão geral (base para cards de Gasto/Leads)', {
      totals: {
        ...totalsOverview,
        cost_per_action_type: costPerActionMapForLog(globalCostPerAction),
      },
      contributors_count: topContributors.length,
      top_contributors: topContributors,
      kind_summary: kindSummary,
      kind_mapping_debug: {
        insights_without_kind_match: insightsWithoutKindMatch,
      },
    });

    return successResponse({
      rows,
      period: {
        date_from: appliedDateFrom ?? null,
        date_to: appliedDateTo ?? null,
      },
      requested_period: {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
      },
      kind_summary: kindSummary,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

