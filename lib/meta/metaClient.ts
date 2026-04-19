/**
 * Meta Graph API Client - Facebook/Instagram Ads
 * Consome endpoints da Meta para campanhas, adsets e insights.
 * NUNCA logar token em console ou logs.
 */

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface MetaMeResponse {
  id: string;
  name?: string;
}

export interface MetaAdAccount {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
}

export interface MetaCampaign {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}

export interface MetaAdSet {
  id: string;
  name?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  billing_event?: string;
  optimization_goal?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaInsight {
  date_start: string;
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  reach?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  /** Custo médio por tipo de ação (Insights API). */
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

function normalizeCostPerActionType(
  input: unknown
): Array<{ action_type: string; value: string }> | null {
  let source: unknown = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  if (!Array.isArray(source) || source.length === 0) return null;
  const mapped = source
    .map((item) => {
      const o = item as { action_type?: unknown; value?: unknown };
      const actionType = String(o?.action_type ?? '').trim();
      if (!actionType) return null;
      // Mantém o valor como string (formato padrão retornado pela Meta API).
      const value = String(o?.value ?? '0');
      return { action_type: actionType, value };
    })
    .filter((x): x is { action_type: string; value: string } => Boolean(x));
  return mapped.length > 0 ? mapped : null;
}

export interface MetaAccountFinance {
  amount_spent?: string;
  balance?: string;
  spend_cap?: string;
  currency?: string;
  timezone_name?: string;
}

export interface MetaPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
}

/** Normaliza budget (Meta pode retornar em centavos) para valor base */
export function normalizeBudget(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return null;
  if (n >= 1000000) return n / 100; // Provavelmente em centavos
  return n;
}

function extractLeadsFromActions(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions || !Array.isArray(actions)) return 0;
  const lead = actions.find((a) => a.action_type === 'lead');
  return lead ? parseInt(lead.value || '0', 10) || 0 : 0;
}

function graphBackoffMs(attempt: number): number {
  return RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function isMetaRateLimitPayload(data: unknown): boolean {
  const code = (data as { error?: { code?: number } } | null)?.error?.code;
  if (typeof code !== 'number') return false;
  if ([4, 17, 32, 613].includes(code)) return true;
  if (code >= 80000 && code <= 80014) return true;
  return false;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const signal = options.signal ?? controller.signal;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal });
      clearTimeout(timeout);
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      const isRetryable =
        err?.name === 'AbortError' ||
        err?.message?.includes('fetch') ||
        err?.message?.includes('ECONNRESET') ||
        err?.message?.includes('ETIMEDOUT');
      if (attempt < retries && isRetryable) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * GET Graph com URL completa (ex.: `paging.next` já inclui `access_token`).
 * Retentar em rate limit (códigos 17, 4, etc.) e mapear token expirado / permissão.
 */
export async function metaGraphGetJson<T>(fullUrl: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetchWithRetry(fullUrl);
    const data = (await res.json()) as T & {
      error?: { code?: number; message?: string; error_subcode?: number };
    };
    if (res.ok) return data as T;
    if (isMetaRateLimitPayload(data) && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, graphBackoffMs(attempt)));
      continue;
    }
    const code = data?.error?.code;
    const msg = data?.error?.message || JSON.stringify(data);
    if (code === 190 || code === 102) {
      throw new Error(`Meta API: token inválido ou expirado (${code}): ${msg}`);
    }
    if (code === 10) {
      throw new Error(`Meta API: permissão insuficiente (ex.: ads_read) — ${msg}`);
    }
    throw new Error(`Meta API error (${res.status}): ${msg}`);
  }
  throw new Error('Meta API: tentativas esgotadas');
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const u = new URL(url);
  u.searchParams.set('access_token', token);
  return metaGraphGetJson<T>(u.toString());
}

/** Valida token: GET /me */
export async function getMe(baseUrl: string, token: string): Promise<MetaMeResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}/me?fields=id,name`;
  return getJson<MetaMeResponse>(url, token);
}

/** Lista contas de anúncio: GET /me/adaccounts */
export async function getAdAccounts(baseUrl: string, token: string): Promise<MetaAdAccount[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/me/adaccounts?fields=id,name,account_status,currency,timezone_name`;
  const data = await getJson<{ data?: MetaAdAccount[]; paging?: MetaPaging }>(url, token);
  const results: MetaAdAccount[] = data?.data ?? [];
  let next = data?.paging?.next;
  while (next) {
    const nextData = await metaGraphGetJson<{ data?: MetaAdAccount[]; paging?: MetaPaging }>(next);
    if (nextData?.data) results.push(...nextData.data);
    next = nextData?.paging?.next;
  }
  return results;
}

/** Lista campanhas de uma conta */
export async function listCampaigns(
  baseUrl: string,
  token: string,
  adAccountId: string
): Promise<MetaCampaign[]> {
  const cleanId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const path = `${cleanId}/campaigns`;
  const fields =
    'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time';
  const url = `${baseUrl.replace(/\/+$/, '')}/${path}?fields=${fields}&limit=100`;
  const data = await getJson<{ data?: MetaCampaign[]; paging?: MetaPaging }>(url, token);
  const results: MetaCampaign[] = data?.data ?? [];
  let next = data?.paging?.next;
  while (next) {
    const nextData = await metaGraphGetJson<{ data?: MetaCampaign[]; paging?: MetaPaging }>(next);
    if (nextData?.data) results.push(...nextData.data);
    next = nextData?.paging?.next;
  }
  const sample = results[0] as unknown as Record<string, unknown> | undefined;
  console.log('[Meta Graph] listCampaigns', {
    count: results.length,
    fields: sample ? Object.keys(sample) : [],
    sample: sample ?? null,
  });
  return results;
}

/** Lista adsets de uma conta */
export async function listAdSets(
  baseUrl: string,
  token: string,
  adAccountId: string
): Promise<MetaAdSet[]> {
  const cleanId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const path = `${cleanId}/adsets`;
  const fields =
    'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,start_time,end_time';
  const url = `${baseUrl.replace(/\/+$/, '')}/${path}?fields=${fields}&limit=100`;
  const data = await getJson<{ data?: MetaAdSet[]; paging?: MetaPaging }>(url, token);
  const results: MetaAdSet[] = data?.data ?? [];
  let next = data?.paging?.next;
  while (next) {
    const nextData = await metaGraphGetJson<{ data?: MetaAdSet[]; paging?: MetaPaging }>(next);
    if (nextData?.data) results.push(...nextData.data);
    next = nextData?.paging?.next;
  }
  const adSample = results[0] as unknown as Record<string, unknown> | undefined;
  console.log('[Meta Graph] listAdSets', {
    count: results.length,
    fields: adSample ? Object.keys(adSample) : [],
    sample: adSample ?? null,
  });
  return results;
}

/** Opção para insights: preset (ex: last_30d) ou intervalo explícito (since/until em YYYY-MM-DD). Use time_range para incluir o dia atual. */
export type InsightsDateOption =
  | string
  | { since: string; until: string };

/**
 * Formata data para YYYY-MM-DD (Meta usa esse formato; timezone é da conta).
 */
export function formatMetaDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Insights diários por campanha. Use time_range (since/until) para dados de uma data específica, ex: hoje. */
export async function getInsightsDaily(
  baseUrl: string,
  token: string,
  adAccountId: string,
  dateOption: InsightsDateOption = 'last_30d'
): Promise<MetaInsight[]> {
  const cleanId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const path = `${cleanId}/insights`;
  const fields =
    'date_start,date_stop,campaign_id,campaign_name,reach,impressions,clicks,spend,cpm,cpc,ctr,actions,action_values,cost_per_action_type';

  const isTimeRange =
    typeof dateOption === 'object' &&
    dateOption !== null &&
    'since' in dateOption &&
    'until' in dateOption;

  const params = isTimeRange
    ? `level=campaign&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since: dateOption.since, until: dateOption.until }))}&fields=${fields}&limit=500`
    : `level=campaign&time_increment=1&date_preset=${encodeURIComponent(String(dateOption))}&fields=${fields}&limit=500`;

  const url = `${baseUrl.replace(/\/+$/, '')}/${path}?${params}`;
  const data = await getJson<{ data?: MetaInsight[]; paging?: MetaPaging }>(url, token);
  const results: MetaInsight[] = data?.data ?? [];
  let next = data?.paging?.next;
  while (next) {
    const nextData = await metaGraphGetJson<{ data?: MetaInsight[]; paging?: MetaPaging }>(next);
    if (nextData?.data) results.push(...nextData.data);
    next = nextData?.paging?.next;
  }
  const insSample = results[0] as unknown as Record<string, unknown> | undefined;
  console.log('[Meta Graph] getInsightsDaily', {
    count: results.length,
    fields: insSample ? Object.keys(insSample) : [],
    sample: insSample ?? null,
    requestedFields:
      'date_start,date_stop,campaign_id,campaign_name,reach,impressions,clicks,spend,cpm,cpc,ctr,actions,action_values,cost_per_action_type',
  });
  return results;
}

/** Dados financeiros da conta */
export async function getAccountFinance(
  baseUrl: string,
  token: string,
  adAccountId: string
): Promise<MetaAccountFinance> {
  const cleanId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const url = `${baseUrl.replace(/\/+$/, '')}/${cleanId}?fields=amount_spent,balance,spend_cap,currency,timezone_name`;
  return getJson<MetaAccountFinance>(url, token);
}

/** Converte MetaInsight para formato persistível */
export function mapInsightToRow(insight: MetaInsight, bancaId: string) {
  const reach = parseInt(insight.reach || '0', 10) || 0;
  const impressions = parseInt(insight.impressions || '0', 10) || 0;
  const clicks = parseInt(insight.clicks || '0', 10) || 0;
  const spend = parseFloat(insight.spend || '0') || 0;
  const leads = extractLeadsFromActions(insight.actions);
  const normalizedCostPerActionType = normalizeCostPerActionType(insight.cost_per_action_type);
  return {
    banca_id: bancaId,
    date: insight.date_start,
    campaign_id: insight.campaign_id || '',
    campaign_name: insight.campaign_name || null,
    reach,
    impressions,
    clicks,
    spend,
    cpm: insight.cpm ? parseFloat(insight.cpm) : null,
    cpc: insight.cpc ? parseFloat(insight.cpc) : null,
    ctr: insight.ctr ? parseFloat(insight.ctr) : null,
    leads,
    raw_actions: insight.actions || null,
    raw_cost_per_action_type: normalizedCostPerActionType,
  };
}
