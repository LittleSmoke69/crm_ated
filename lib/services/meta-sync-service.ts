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
  mapInsightToRow,
  normalizeBudget,
  formatMetaDate,
} from '@/lib/meta/metaClient';

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v19.0';
const DEFAULT_DATE_PRESET = 'last_30d';

/** Retorna time_range desde (hoje - dias) até hoje em YYYY-MM-DD. Meta usa timezone da conta. */
function getTimeRangeSinceUntil(daysAgo: number): { since: string; until: string } {
  const now = new Date();
  const until = formatMetaDate(now);
  const since = new Date(now);
  since.setDate(since.getDate() - daysAgo);
  return { since: formatMetaDate(since), until };
}

export interface MetaConfigInput {
  base_url?: string;
  access_token?: string;
  ad_account_id?: string;
  pixel_id?: string;
  default_campaign_id?: string;
  is_active?: boolean;
}

export interface MetaIntegrationRow {
  id: string;
  banca_id: string;
  base_url: string;
  access_token_encrypted: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  currency: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
}

export async function getMetaConfig(bancaId: string): Promise<MetaIntegrationRow | null> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integrations')
    .select('id, banca_id, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset')
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (error || !data) return null;
  return data as MetaIntegrationRow;
}

export async function upsertMetaConfig(
  bancaId: string,
  input: MetaConfigInput
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

  if (input.access_token?.trim()) {
    const token = input.access_token.trim();
    updatePayload.access_token_encrypted = encryptionService.encrypt(token);
    updatePayload.token_last4 = token.length >= 4 ? token.slice(-4) : '****';
  }

  const { data: existing } = await supabaseServiceRole
    .from('meta_integrations')
    .select('id')
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integrations')
      .update(updatePayload)
      .eq('banca_id', bancaId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as MetaIntegrationRow;
  }

  const insertRow = {
    banca_id: bancaId,
    ...updatePayload,
  };
  const { data, error } = await supabaseServiceRole
    .from('meta_integrations')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as MetaIntegrationRow;
}

export async function getDecryptedToken(bancaId: string): Promise<string | null> {
  const { data } = await supabaseServiceRole
    .from('meta_integrations')
    .select('access_token_encrypted')
    .eq('banca_id', bancaId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data?.access_token_encrypted) return null;
  try {
    return encryptionService.decrypt(data.access_token_encrypted);
  } catch {
    return null;
  }
}

export async function testConnection(bancaId: string): Promise<{
  success: boolean;
  me?: { id: string; name?: string };
  adAccounts?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado ou inválido. Configure o token primeiro.' };
  }

  const { data: config } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url')
    .eq('banca_id', bancaId)
    .single();

  const baseUrl = (config?.base_url as string) || DEFAULT_BASE_URL;

  try {
    const me = await getMe(baseUrl, token);
    const adAccounts = await getAdAccounts(baseUrl, token);
    return {
      success: true,
      me: { id: me.id, name: me.name },
      adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.name })),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao conectar com a Meta API' };
  }
}

export async function loadCampaigns(bancaId: string): Promise<{
  success: boolean;
  campaigns?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const { data: config } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url, ad_account_id')
    .eq('banca_id', bancaId)
    .single();

  const baseUrl = (config?.base_url as string) || DEFAULT_BASE_URL;
  const adAccountId = config?.ad_account_id as string | undefined;
  if (!adAccountId) {
    return { success: false, error: 'Ad Account ID não configurado.' };
  }

  try {
    const campaigns = await listCampaigns(baseUrl, token, adAccountId);
    return {
      success: true,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    };
  } catch (err: any) {
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
  const [campaignsResult, integrationResult] = await Promise.all([
    activeOnly
      ? supabaseServiceRole
          .from('meta_campaigns')
          .select('campaign_id')
          .eq('banca_id', bancaId)
          .eq('status', 'ACTIVE')
          .eq('effective_status', 'ACTIVE')
      : Promise.resolve({ data: null }),
    supabaseServiceRole
      .from('meta_integrations')
      .select('currency')
      .eq('banca_id', bancaId)
      .maybeSingle(),
  ]);

  const currency = (integrationResult as any).data?.currency || 'BRL';

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
    campaignsQuery = campaignsQuery.eq('status', 'ACTIVE').eq('effective_status', 'ACTIVE');
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
    .select('campaign_id, campaign_name, reach, impressions, clicks, spend, leads')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  if (dateFrom) insightsQuery = insightsQuery.gte('date', dateFrom);
  if (dateTo) insightsQuery = insightsQuery.lte('date', dateTo);

  const { data: insights } = await insightsQuery;
  if (!insights?.length) {
    return campaigns.map((c: { campaign_id: string; name: string | null }) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
    }));
  }

  const metricsByCampaign = new Map<string, { reach: number; impressions: number; clicks: number; spend: number; leads: number }>();
  insights.forEach((row: { campaign_id: string; campaign_name?: string | null; reach?: number; impressions?: number; clicks?: number; spend?: number; leads?: number }) => {
    const cur = metricsByCampaign.get(row.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0 };
    cur.reach += Number(row.reach) || 0;
    cur.impressions += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.spend += Number(row.spend) || 0;
    cur.leads += Number(row.leads) || 0;
    metricsByCampaign.set(row.campaign_id, cur);
  });

  return campaigns.map((c: { campaign_id: string; name: string | null }) => {
    const m = metricsByCampaign.get(c.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0 };
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: m.reach,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.spend,
      leads: m.leads,
    };
  });
}

export async function runSync(bancaId: string, datePreset = DEFAULT_DATE_PRESET): Promise<{
  success: boolean;
  campaignsCount?: number;
  adsetsCount?: number;
  insightsCount?: number;
  error?: string;
}> {
  const token = await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const { data: config } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url, ad_account_id')
    .eq('banca_id', bancaId)
    .single();

  const baseUrl = (config?.base_url as string) || DEFAULT_BASE_URL;
  const adAccountId = config?.ad_account_id as string | undefined;
  if (!adAccountId) {
    return { success: false, error: 'Ad Account ID não configurado.' };
  }

  let campaignsCount = 0;
  let adsetsCount = 0;
  let insightsCount = 0;

  // Usar time_range (since/until) em vez de date_preset para incluir o dia atual nos insights (Meta recomenda para dados de hoje).
  const timeRange = getTimeRangeSinceUntil(30);

  try {
    const [campaigns, adsets, insights, accountFinance] = await Promise.all([
      listCampaigns(baseUrl, token, adAccountId),
      listAdSets(baseUrl, token, adAccountId),
      getInsightsDaily(baseUrl, token, adAccountId, timeRange),
      getAccountFinance(baseUrl, token, adAccountId).catch(() => null),
    ]);

    const accountCurrency = accountFinance?.currency || 'BRL';

    const now = new Date().toISOString();

    for (const c of campaigns) {
      const { error } = await supabaseServiceRole
        .from('meta_campaigns')
        .upsert(
          {
            banca_id: bancaId,
            campaign_id: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            effective_status: c.effective_status,
            daily_budget: normalizeBudget(c.daily_budget),
            lifetime_budget: normalizeBudget(c.lifetime_budget),
            start_time: c.start_time || null,
            stop_time: c.stop_time || null,
            updated_at: now,
          },
          { onConflict: 'banca_id,campaign_id' }
        );
      if (!error) campaignsCount++;
    }

    for (const a of adsets) {
      const { error } = await supabaseServiceRole
        .from('meta_adsets')
        .upsert(
          {
            banca_id: bancaId,
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
      const row = mapInsightToRow(ins, bancaId);
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

    await supabaseServiceRole
      .from('meta_integrations')
      .update({
        last_sync_at: now,
        last_sync_error: null,
        last_sync_date_preset: `${timeRange.since}..${timeRange.until}`,
        currency: accountCurrency,
        updated_at: now,
      })
      .eq('banca_id', bancaId);

    return {
      success: true,
      campaignsCount,
      adsetsCount,
      insightsCount,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Erro ao sincronizar';
    await supabaseServiceRole
      .from('meta_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('banca_id', bancaId);

    return { success: false, error: errMsg };
  }
}
