import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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

    const [bancasRes, linksRes, configsRes, campaignsResRaw, insightsResRaw, legacyRes] = await Promise.all([
      supabaseServiceRole.from('crm_bancas').select('id, name, url').order('name', { ascending: true }),
      supabaseServiceRole
        .from('meta_integration_bancas')
        .select('banca_id, integration_id'),
      supabaseServiceRole
        .from('meta_integration_configs')
        .select('id, is_active, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, last_sync_at, last_sync_error, last_sync_date_preset'),
      supabaseServiceRole
        .from('meta_campaigns')
        .select('banca_id, campaign_id, name, status, effective_status, updated_at')
        .order('updated_at', { ascending: false }),
      (() => {
        let query = supabaseServiceRole
          .from('meta_insights_daily')
          .select('banca_id, reach, impressions, clicks, leads, spend');
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
    const insights = insightsResRaw.data ?? [];

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
    for (const row of insights) {
      const bid = String((row as { banca_id: string }).banca_id);
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

    return successResponse({
      rows,
      period: {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
      },
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

