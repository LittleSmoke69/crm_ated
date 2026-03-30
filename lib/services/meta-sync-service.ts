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
  type MetaInsight,
} from '@/lib/meta/metaClient';
import { buildCampaignConsultorSummary } from '@/lib/services/meta-campaign-consultors';

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v19.0';
const DEFAULT_DATE_PRESET = 'last_30d';

/** Logs do retorno bruto da Meta (admin / sync); nunca incluir token. */
const META_API_LOG = '[Meta Ads API]';

function logMetaReturn(context: string, data: Record<string, unknown>): void {
  console.log(META_API_LOG, context, data);
}

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
  /** integration_id (novo modelo compartilhado) */
  id: string;
  /** banca_id selecionada no contexto (para compat/UI) */
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
  banca_ids?: string[];
}

async function resolveIntegrationIdByBanca(bancaId: string): Promise<string | null> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id')
    .eq('banca_id', bancaId)
    .maybeSingle();
  if (error || !data?.integration_id) return null;
  return String(data.integration_id);
}

async function listBancasByIntegration(integrationId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('banca_id')
    .eq('integration_id', integrationId);
  if (error || !data) return [];
  return data.map((r: any) => String(r.banca_id));
}

/** Moeda da conta Meta (integração compartilhada ou legado por banca). */
async function getMetaCurrencyForBanca(bancaId: string): Promise<string> {
  const integrationId = await resolveIntegrationIdByBanca(bancaId);
  if (integrationId) {
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
      'id, banca_id, base_url, access_token_encrypted, token_last4, ad_account_id, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset'
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

/** base_url e ad_account para integração nova ou legada (Meta API). */
async function resolveMetaApiContext(bancaId: string): Promise<{
  baseUrl: string;
  adAccountId: string | null;
}> {
  const integrationId = await resolveIntegrationIdByBanca(bancaId);
  if (integrationId) {
    const { data } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('base_url, ad_account_id')
      .eq('id', integrationId)
      .maybeSingle();
    return {
      baseUrl: (data?.base_url as string) || DEFAULT_BASE_URL,
      adAccountId: (data?.ad_account_id as string) || null,
    };
  }
  const { data: leg } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url, ad_account_id')
    .eq('banca_id', bancaId)
    .maybeSingle();
  return {
    baseUrl: (leg?.base_url as string) || DEFAULT_BASE_URL,
    adAccountId: (leg?.ad_account_id as string) || null,
  };
}

export async function getMetaConfig(bancaId: string): Promise<MetaIntegrationRow | null> {
  const integrationId = await resolveIntegrationIdByBanca(bancaId);
  if (integrationId) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('id, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset, access_token_encrypted')
      .eq('id', integrationId)
      .maybeSingle();

    if (error || !data) return null;
    const banca_ids = await listBancasByIntegration(integrationId);
    return { ...(data as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
  }
  return getLegacyMetaIntegrationByBanca(bancaId);
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

export async function upsertMetaConfig(
  bancaId: string,
  input: MetaConfigInput,
  bancaIdsToLink?: string[] | null
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

  const existingIntegrationId = await resolveIntegrationIdByBanca(bancaId);

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

export async function getDecryptedToken(bancaId: string): Promise<string | null> {
  const integrationId = await resolveIntegrationIdByBanca(bancaId);
  let encrypted: string | null | undefined;
  if (integrationId) {
    const { data } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('access_token_encrypted')
      .eq('id', integrationId)
      .eq('is_active', true)
      .maybeSingle();
    encrypted = data?.access_token_encrypted;
  } else {
    const { data } = await supabaseServiceRole
      .from('meta_integrations')
      .select('access_token_encrypted')
      .eq('banca_id', bancaId)
      .eq('is_active', true)
      .maybeSingle();
    encrypted = data?.access_token_encrypted;
  }

  if (!encrypted) return null;
  try {
    return encryptionService.decrypt(encrypted);
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

  const { baseUrl } = await resolveMetaApiContext(bancaId);

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

export async function loadCampaigns(bancaId: string): Promise<{
  success: boolean;
  campaigns?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const { baseUrl, adAccountId: adAccountIdRaw } = await resolveMetaApiContext(bancaId);
  const adAccountId = adAccountIdRaw ?? undefined;
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
          .eq('status', 'ACTIVE')
          .eq('effective_status', 'ACTIVE')
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

  const firstInsight = data[0] as Record<string, unknown>;
  console.log('[Meta Ads] getMetaInsightsAggregated payload:', {
    bancaId,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    activeOnly,
    rows: data.length,
    fields: Object.keys(firstInsight ?? {}),
    sample: {
      campaign_id: firstInsight?.campaign_id ?? null,
      reach: firstInsight?.reach ?? null,
      impressions: firstInsight?.impressions ?? null,
      clicks: firstInsight?.clicks ?? null,
      leads: firstInsight?.leads ?? null,
      spend: firstInsight?.spend ?? null,
    },
  });

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
    .select('campaign_id, campaign_name, reach, impressions, clicks, spend, leads, raw_actions')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  if (dateFrom) insightsQuery = insightsQuery.gte('date', dateFrom);
  if (dateTo) insightsQuery = insightsQuery.lte('date', dateTo);

  const { data: insights } = await insightsQuery;
  const campaignIdsForSummary = campaigns.map((c: { campaign_id: string }) => c.campaign_id);
  const consultorSummaryByCampaign = await buildCampaignConsultorSummary(
    bancaId,
    campaignIdsForSummary,
    dateFrom ?? null,
    dateTo ?? null
  );

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
    };
    });
  }

  const firstCampaignInsight = insights[0] as Record<string, unknown>;
  const firstRawActions = Array.isArray(firstCampaignInsight?.raw_actions)
    ? (firstCampaignInsight.raw_actions as Array<{ action_type?: string; value?: string }>)
    : [];
  console.log('[Meta Ads] getMetaCampaignsWithInsights payload:', {
    bancaId,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    activeOnly,
    campaignCount: campaigns.length,
    insightsRows: insights.length,
    fields: Object.keys(firstCampaignInsight ?? {}),
    sample: {
      campaign_id: firstCampaignInsight?.campaign_id ?? null,
      campaign_name: firstCampaignInsight?.campaign_name ?? null,
      reach: firstCampaignInsight?.reach ?? null,
      impressions: firstCampaignInsight?.impressions ?? null,
      clicks: firstCampaignInsight?.clicks ?? null,
      spend: firstCampaignInsight?.spend ?? null,
      leads: firstCampaignInsight?.leads ?? null,
      raw_actions_count: firstRawActions.length,
      raw_action_types: firstRawActions
        .map((action) => action?.action_type)
        .filter((type): type is string => Boolean(type))
        .slice(0, 15),
    },
  });

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
      return c.status === 'ACTIVE' && c.effective_status === 'ACTIVE';
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
    const consultorSummaryByCampaign = await buildCampaignConsultorSummary(
      bancaId,
      orderedIds,
      dateFrom ?? null,
      dateTo ?? null
    );

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

/**
 * Reatribui uma campanha (e seus dados sincronizados) para outra banca
 * dentro do mesmo vínculo de integração compartilhada.
 */
export async function assignCampaignToBanca(
  contextBancaId: string,
  sourceBancaId: string,
  targetBancaId: string,
  campaignId: string
): Promise<{ success: boolean; moved?: { campaigns: number; adsets: number; insights: number }; error?: string }> {
  const integrationId = await resolveIntegrationIdByBanca(contextBancaId);
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

    // Se já houver linhas de insights no destino para o mesmo campaign/date, mantém só a origem (mais recente do fluxo manual).
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
        campaigns: movedCampaigns?.length ?? 0,
        adsets: movedAdsets?.length ?? 0,
        insights: movedInsights?.length ?? 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao reatribuir campanha.' };
  }
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

  const { baseUrl, adAccountId: adAccountIdRaw } = await resolveMetaApiContext(bancaId);
  const adAccountId = adAccountIdRaw ?? undefined;
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

    const integrationId = await resolveIntegrationIdByBanca(bancaId);
    const linkedBancas = integrationId ? await listBancasByIntegration(integrationId) : [bancaId];
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

    const presetLabel = `${timeRange.since}..${timeRange.until}`;
    const integrationIdAfter = await resolveIntegrationIdByBanca(bancaId);
    if (integrationIdAfter) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: now,
        last_sync_error: null,
        last_sync_date_preset: presetLabel,
        currency: accountCurrency,
        updated_at: now,
        })
        .eq('id', integrationIdAfter);
    } else {
      await supabaseServiceRole
        .from('meta_integrations')
        .update({
          last_sync_at: now,
          last_sync_error: null,
          last_sync_date_preset: presetLabel,
          currency: accountCurrency,
          updated_at: now,
        })
        .eq('banca_id', bancaId);
    }

    logMetaReturn('runSync → DB concluído', {
      banca_id: bancaId,
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
    logMetaReturn('runSync ✗', { banca_id: bancaId, error: errMsg });
    const ts = new Date().toISOString();
    const integrationIdErr = await resolveIntegrationIdByBanca(bancaId);
    if (integrationIdErr) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: ts,
        last_sync_error: errMsg,
        updated_at: ts,
        })
        .eq('id', integrationIdErr);
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
