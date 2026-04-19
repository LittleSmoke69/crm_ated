/**
 * Relatórios Meta Ads (Marketing API) — campanhas ativas e spend.
 * Multi-tenant: cada chamada recebe baseUrl + accessToken + adAccountId da banca/integração.
 */

import { metaGraphGetJson, type MetaPaging } from '@/lib/meta/metaClient';

export const META_GRAPH_DEFAULT_BASE_URL = 'https://graph.facebook.com/v25.0';

/** Filtro obrigatório do produto: apenas entrega ativa ao nível de campanha. */
const FILTER_ACTIVE_DELIVERY = JSON.stringify([
  { field: 'campaign.delivery_info', operator: 'IN', value: ['active'] },
]);

export type ActiveCampaignSpendRow = {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
};

export type ActiveCampaignsSpendResult = {
  campaigns: ActiveCampaignSpendRow[];
  totalSpend: number;
};

export type GetActiveCampaignsSpendOptions = {
  /**
   * Preset da Marketing API (ex.: `last_7d`, `last_30d`). Opcional.
   * Só é usado se `timeRange` não for informado. Sem `timeRange` nem `datePreset`, o padrão é **hoje** (granularidade diária).
   */
  datePreset?: string;
  /** Intervalo explícito (since/until YYYY-MM-DD). Tem prioridade sobre `datePreset`. */
  timeRange?: { since: string; until: string };
  /**
   * Granularidade temporal (ex.: `1` = por dia). No padrão “hoje”, assume `1` se omitido.
   * Com `datePreset`, omitir costuma agregar o período inteiro por campanha (comportamento da Meta).
   */
  timeIncrement?: number;
  /**
   * IANA: define o “dia atual” quando não há `timeRange` nem `datePreset`.
   * Default `America/Sao_Paulo` (calendário civil BR).
   */
  calendarTimeZone?: string;
};

type InsightCampaignRow = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
};

type InsightsPage = {
  data?: InsightCampaignRow[];
  paging?: MetaPaging;
};

function normalizeActId(adAccountId: string): string {
  const t = String(adAccountId).trim();
  return t.startsWith('act_') ? t : `act_${t}`;
}

/** YYYY-MM-DD do “agora” em um fuso IANA (ex.: dia civil em São Paulo). */
export function formatMetaCalendarDayYmd(timeZone: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const DEFAULT_CALENDAR_TZ = 'America/Sao_Paulo';

function resolveInsightsDateQuery(opts: GetActiveCampaignsSpendOptions | undefined): {
  timeRange: { since: string; until: string } | null;
  datePreset: string | null;
  timeIncrement: number | undefined;
} {
  const o = opts ?? {};
  if (o.timeRange?.since && o.timeRange?.until) {
    return {
      timeRange: { since: String(o.timeRange.since).trim(), until: String(o.timeRange.until).trim() },
      datePreset: null,
      timeIncrement: o.timeIncrement,
    };
  }
  if (o.datePreset != null && String(o.datePreset).trim() !== '') {
    return {
      timeRange: null,
      datePreset: String(o.datePreset).trim(),
      timeIncrement: o.timeIncrement,
    };
  }
  const tz = (o.calendarTimeZone ?? DEFAULT_CALENDAR_TZ).trim() || DEFAULT_CALENDAR_TZ;
  const day = formatMetaCalendarDayYmd(tz);
  return {
    timeRange: { since: day, until: day },
    datePreset: null,
    timeIncrement: o.timeIncrement ?? 1,
  };
}

function parseNum(s: string | undefined, int = false): number {
  const v = int ? parseInt(String(s ?? '0'), 10) : parseFloat(String(s ?? '0'));
  return Number.isFinite(v) ? v : 0;
}

function aggregateRows(rows: InsightCampaignRow[]): ActiveCampaignSpendRow[] {
  const map = new Map<string, ActiveCampaignSpendRow>();
  for (const r of rows) {
    const id = String(r.campaign_id ?? '').trim();
    if (!id) continue;
    const prev = map.get(id) ?? { id, name: String(r.campaign_name ?? ''), spend: 0, impressions: 0, clicks: 0 };
    prev.spend += parseNum(r.spend, false);
    prev.impressions += parseNum(r.impressions, true);
    prev.clicks += parseNum(r.clicks, true);
    if (!prev.name && r.campaign_name) prev.name = String(r.campaign_name);
    map.set(id, prev);
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}

function buildFirstInsightsUrl(
  baseUrl: string,
  adAccountId: string,
  accessToken: string,
  opts: GetActiveCampaignsSpendOptions
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const act = normalizeActId(adAccountId);
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks';
  const u = new URL(`${cleanBase}/${act}/insights`);
  u.searchParams.set('access_token', accessToken);
  u.searchParams.set('level', 'campaign');
  u.searchParams.set('fields', fields);
  u.searchParams.set('filtering', FILTER_ACTIVE_DELIVERY);
  u.searchParams.set('limit', '500');
  const resolved = resolveInsightsDateQuery(opts);
  if (resolved.timeRange) {
    u.searchParams.set('time_range', JSON.stringify(resolved.timeRange));
  } else if (resolved.datePreset) {
    u.searchParams.set('date_preset', resolved.datePreset);
  }
  if (resolved.timeIncrement != null && resolved.timeIncrement > 0) {
    u.searchParams.set('time_increment', String(resolved.timeIncrement));
  }
  return u.toString();
}

/**
 * Insights em conta de anúncios: campanhas com entrega ativa e métricas de spend.
 * Paginação (`paging.next`) e retentativas em rate limit via `metaGraphGetJson`.
 */
export async function getActiveCampaignsSpend(
  baseUrl: string,
  accessToken: string,
  adAccountId: string,
  options?: GetActiveCampaignsSpendOptions
): Promise<ActiveCampaignsSpendResult> {
  const first = buildFirstInsightsUrl(baseUrl, adAccountId, accessToken, options ?? {});
  const raw: InsightCampaignRow[] = [];
  let page = await metaGraphGetJson<InsightsPage>(first);
  raw.push(...(page.data ?? []));
  let next = page.paging?.next;
  while (next) {
    page = await metaGraphGetJson<InsightsPage>(next);
    raw.push(...(page.data ?? []));
    next = page.paging?.next;
  }
  const campaigns = aggregateRows(raw);
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  return { campaigns, totalSpend };
}
