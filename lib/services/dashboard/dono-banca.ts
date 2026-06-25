import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinateIds } from '@/lib/middleware/permissions';
import { getMetaInsightsAggregated, getMetaCampaignsWithInsights } from '@/lib/services/meta-sync-service';
import { crmServiceVerboseLog } from '@/lib/utils/meta-debug-log';

export interface DonoBancaDashboardParams {
  userId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  metaActiveOnly?: boolean;
  /** Quando true, não busca Meta Ads. Use quando Meta será carregado em chamada separada. */
  skipMeta?: boolean;
  /** Quando true, não chama dashboard-metrics (frontend já buscou via only_external_metrics). */
  skipExternalMetrics?: boolean;
  /** Paginação de gerentes (Netlify). Omitir ambos = processar todos de uma vez (compatível com outras rotas). */
  gerentesOffset?: number;
  gerentesLimit?: number;
  /** Cancela chamadas ao CRM quando o cliente aborta a requisição. */
  signal?: AbortSignal;
}

export interface DashboardByBancaParams {
  bancaId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  metaActiveOnly?: boolean;
  /** Quando true, não busca Meta Ads. Use quando Meta será carregado em chamada separada. */
  skipMeta?: boolean;
  /** Quando true, não chama dashboard-metrics (frontend já buscou via only_external_metrics). */
  skipExternalMetrics?: boolean;
  gerentesOffset?: number;
  gerentesLimit?: number;
  /** Cancela chamadas ao CRM quando o cliente aborta a requisição. */
  signal?: AbortSignal;
}

/**
 * Normaliza a URL da banca removendo protocolo, /api/crm e barras finais
 * Garante que a URL esteja no formato correto para construir endpoints
 */
function normalizeBancaUrl(bancaUrl: string): string {
  if (!bancaUrl) return bancaUrl;
  
  let normalized = bancaUrl.trim();
  
  // Remove protocolo se presente
  normalized = normalized.replace(/^https?:\/\//i, '');
  
  // Remove /api/crm se presente
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  
  // Remove barras finais
  normalized = normalized.replace(/\/+$/, '').trim();
  
  // Adiciona protocolo https:// e normaliza para comparação (host é case-insensitive)
  if (normalized) {
    normalized = `https://${normalized}`.toLowerCase();
  }
  
  return normalized;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

function getCrmFetchSignal(requestSignal?: AbortSignal | null, timeoutMs = 60000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!requestSignal) return timeout;
  return AbortSignal.any([requestSignal, timeout]);
}

/** Consultores buscados em paralelo no CRM (evita N×latência sequencial). Reduzido para
 *  4 por padrão: concorrência alta era a principal causa de 429 (Too Many Attempts) no CRM. */
const CRM_INDICATEDS_CONCURRENCY = (() => {
  const raw = parseInt(String(process.env.CRM_INDICATEDS_CONCURRENCY ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 30) return raw;
  return 4;
})();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Espera aleatória (default 1s–3s) para espaçar requisições e contornar rate limit (429). */
function randomDelayMs(minMs = 1000, maxMs = 3000): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/** Nº máximo de novas tentativas em dashboard-metrics quando a CRM responde 429 (Too Many Attempts). */
const DASHBOARD_METRICS_429_MAX_RETRIES = (() => {
  const raw = parseInt(String(process.env.CRM_DASHBOARD_METRICS_429_RETRIES ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 6) return raw;
  return 3;
})();

/** Tentativas para cohort-real-players (chamada pesada; throttle do CRM é mais agressivo). */
const COHORT_429_MAX_RETRIES = (() => {
  const raw = parseInt(String(process.env.CRM_COHORT_429_RETRIES ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 10) return raw;
  return 5;
})();

/**
 * Timeout (ms) por requisição do cohort-real-players. Bem maior que o default (60s)
 * porque a query do CRM é pesada e pode levar 60s+. A rota permite até 300s (maxDuration).
 * Ajustável via env CRM_COHORT_TIMEOUT_MS.
 */
const COHORT_FETCH_TIMEOUT_MS = (() => {
  const raw = parseInt(String(process.env.CRM_COHORT_TIMEOUT_MS ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 30000 && raw <= 290000) return raw;
  return 180000;
})();

/**
 * Espera sugerida pelo header `Retry-After` (segundos ou data HTTP), em ms.
 * Limitada a [1s, 15s] para não travar a request por muito tempo. null se ausente.
 */
function parseRetryAfterMs(res: Response): number | null {
  const ra = res.headers.get('retry-after');
  if (!ra) return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.min(15000, Math.max(1000, secs * 1000));
  const when = Date.parse(ra);
  if (!Number.isNaN(when)) return Math.min(15000, Math.max(0, when - Date.now()));
  return null;
}

/**
 * Espaçamento mínimo (ms) entre INÍCIOS de requisições ao CRM. Mesmo com concorrência,
 * o portão serializa os "starts" para não estourar o throttle (Too Many Attempts).
 * Ajustável via env CRM_MIN_REQUEST_INTERVAL_MS.
 */
const CRM_MIN_REQUEST_INTERVAL_MS = (() => {
  const raw = parseInt(String(process.env.CRM_MIN_REQUEST_INTERVAL_MS ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 2000) return raw;
  return 200;
})();

let crmNextAllowedAt = 0;

/** Aguarda a vez na fila de saída para o CRM (espaça os starts em CRM_MIN_REQUEST_INTERVAL_MS). */
async function crmThrottleGate(signal?: AbortSignal): Promise<void> {
  if (CRM_MIN_REQUEST_INTERVAL_MS <= 0) {
    throwIfAborted(signal);
    return;
  }
  const now = Date.now();
  const scheduled = Math.max(now, crmNextAllowedAt);
  crmNextAllowedAt = scheduled + CRM_MIN_REQUEST_INTERVAL_MS;
  const wait = scheduled - now;
  if (wait > 0) await sleep(wait);
  throwIfAborted(signal);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

/** 404 esperado quando consultor não existe ou não tem indicados no período. */
function isExpectedEmptyIndicatedsResponse(status: number, body: string): boolean {
  if (status !== 404) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('consultant not found') ||
    lower.includes('no indicateds found') ||
    lower.includes('nenhum indicado')
  );
}

/** Erros que não devem gerar warn verboso por consultor (rate limit, vazio esperado). */
function isSuppressedIndicatedsFetchError(status: number, body: string): boolean {
  if (status === 429) return true;
  return isExpectedEmptyIndicatedsResponse(status, body);
}

/** Lead retornado por get-indicateds-by-consultant (campos usados na agregação) */
export interface IndicatedLead {
  id?: string | number;
  consultant_id?: number;
  consultant_name?: string;
  consultant_email?: string;
  total_depositado?: number;
  total_apostado?: number;
  total_apostado_loteria?: number;
  total_apostado_bichao?: number;
  total_ganho?: number;
  total_saque?: number;
  total_depositos_count?: number;
  status?: string;
  created_at?: string | null;
}

/** Métricas agregadas por consultor (email como chave) */
export interface ConsultantAggregatedMetrics {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  active_leads: number;
  net_profit: number;
  conversion_rate: number;
  total_depositos_count: number;
  /** Nome do consultor (primeira ocorrência na lista de leads), para exibição no Top 5 */
  consultant_name?: string;
}

const EMPTY_CONSULTANT_METRICS: ConsultantAggregatedMetrics = {
  total_leads: 0,
  total_deposited: 0,
  total_bets: 0,
  total_prizes: 0,
  active_leads: 0,
  net_profit: 0,
  conversion_rate: 0,
  total_depositos_count: 0,
};

/**
 * Busca todos os indicados no período via uma única chamada get-indicateds-by-consultant (from/to).
 * Não envia consultant — a API externa pode retornar vazio se exigir consultant.
 * Prefira fetchIndicatedsByConsultants quando tiver a lista de emails (como o CRM).
 */
export async function fetchIndicatedsByPeriod(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  signal?: AbortSignal
): Promise<IndicatedLead[]> {
  const apiKey = process.env.CRM_API_KEY;
  const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
  const perPage = 2000;
  const maxPages = 100;
  const allData: IndicatedLead[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    throwIfAborted(signal);
    const params = new URLSearchParams();
    params.set('per_page', String(perPage));
    params.set('page', String(page));
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const url = `${baseUrl}?${params.toString()}`;
    await crmThrottleGate(signal);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
      signal: getCrmFetchSignal(signal),
    });
    if (!res.ok) break;
    const result = await res.json();
    const data = result?.data;
    if (!Array.isArray(data) || data.length === 0) break;
    allData.push(...(data as IndicatedLead[]));
    const lastPage = result?.pagination?.last_page ?? 1;
    if (page >= lastPage || data.length < perPage) hasMore = false;
    else page++;
  }
  return allData;
}

/**
 * Busca indicados de um único consultor (com paginação interna).
 */
async function fetchIndicatedsForConsultant(
  cleanBancaUrl: string,
  email: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  signal?: AbortSignal
): Promise<IndicatedLead[]> {
  const trimmed = email?.trim?.();
  if (!trimmed) return [];
  const apiKey = process.env.CRM_API_KEY;
  const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
  const perPage = 2000;
  const maxPagesPerConsultant = 50;
  const leads: IndicatedLead[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPagesPerConsultant) {
    throwIfAborted(signal);
    const params = new URLSearchParams();
    params.set('consultant', trimmed);
    params.set('per_page', String(perPage));
    params.set('page', String(page));
    params.set('sort', 'created_at');
    params.set('direction', 'desc');
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const url = `${baseUrl}?${params.toString()}`;
    try {
      await crmThrottleGate(signal);
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: getCrmFetchSignal(signal),
      });
      if (!res.ok) {
        if (page === 1) {
          const body = await res.text().catch(() => '');
          if (!isSuppressedIndicatedsFetchError(res.status, body)) {
            await logCrmFetchFailure('get-indicateds-by-consultant', new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }), {
              url,
              hasApiKey: Boolean(apiKey),
              durationMs: 0,
              extra: { consultant: `${trimmed.slice(0, 5)}***`, page },
            });
          }
        }
        break;
      }
      const result = await res.json();
      const data = result?.data;
      if (!Array.isArray(data) || data.length === 0) break;
      leads.push(...(data as IndicatedLead[]));
      if (data.length < perPage) hasMore = false;
      else page++;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      break;
    }
  }
  return leads;
}

/**
 * Busca indicados da banca da mesma forma que o CRM: uma chamada get-indicateds-by-consultant
 * por consultor/gerente (consultant=email). Agrega todos os resultados.
 * Usar quando a API externa exigir o parâmetro consultant para retornar dados.
 */
export async function fetchIndicatedsByConsultants(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  consultantEmails: string[],
  signal?: AbortSignal
): Promise<IndicatedLead[]> {
  if (!consultantEmails.length) return [];
  const uniqueEmails = [...new Set(consultantEmails.map((e) => e?.trim?.()).filter(Boolean) as string[])];
  if (!uniqueEmails.length) return [];

  const perConsultant = await mapWithConcurrency(
    uniqueEmails,
    CRM_INDICATEDS_CONCURRENCY,
    (email) => fetchIndicatedsForConsultant(cleanBancaUrl, email, dateFrom, dateTo, signal)
  );

  const allData: IndicatedLead[] = [];
  const seenIds = new Set<string>();
  for (const leads of perConsultant) {
    for (const lead of leads) {
      const id = lead?.id ?? (lead as { _originalId?: string | number })?._originalId;
      if (id && !seenIds.has(String(id))) {
        seenIds.add(String(id));
        allData.push(lead);
      } else if (!id) {
        allData.push(lead);
      }
    }
  }
  return allData;
}

/**
 * Agrega a lista de leads por consultant_email e retorna um mapa de métricas por consultor.
 * Uma única requisição get-indicateds-by-consultant (from/to) já traz todos os leads; esta função
 * transforma em totais por consultor.
 */
export function aggregateIndicatedsByConsultant(leads: IndicatedLead[]): Map<string, ConsultantAggregatedMetrics> {
  const byEmail = new Map<string, ConsultantAggregatedMetrics>();

  for (const lead of leads) {
    const email = lead.consultant_email?.trim?.() || '';
    if (!email) continue;
    const totalDepositado = Number(lead.total_depositado) || 0;
    const totalApostado = Number(lead.total_apostado) ?? (Number(lead.total_apostado_loteria) || 0) + (Number(lead.total_apostado_bichao) || 0);
    const totalGanho = Number(lead.total_ganho) || 0;
    const totalSaque = Number(lead.total_saque) || 0;
    const depositosCount = parseInt(String(lead.total_depositos_count || 0), 10) || 0;
    const isActive = (lead.status === 'ativo' || lead.status === 'active' || lead.status === 'deposito');

    if (!byEmail.has(email)) {
      byEmail.set(email, { ...EMPTY_CONSULTANT_METRICS, consultant_name: lead.consultant_name?.trim?.() || undefined });
    }
    const m = byEmail.get(email)!;
    m.total_leads += 1;
    m.total_deposited += totalDepositado;
    m.total_bets += totalApostado;
    m.total_prizes += totalGanho;
    m.total_depositos_count += depositosCount;
    if (isActive) m.active_leads += 1;
  }

  for (const m of byEmail.values()) {
    m.net_profit = m.total_deposited - m.total_prizes;
    m.conversion_rate = m.total_leads > 0 ? (m.active_leads / m.total_leads) * 100 : 0;
  }
  return byEmail;
}

/** Formato das métricas externas (resumo geral) esperado pelo dashboard */
export interface ExternalMetricsShape {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  total_withdrawals: number;
  awarded_clients_count: number;
  total_depositos_count: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg: number;
  net_profit: number;
}

/**
 * Calcula o resumo geral (externalMetrics) a partir apenas da lista de leads
 * retornada por get-indicateds-by-consultant. Usado pelo gestor-trafego para não depender de dashboard-metrics.
 */
export function computeExternalMetricsFromLeads(leads: IndicatedLead[]): ExternalMetricsShape {
  let total_deposited = 0;
  let total_bets = 0;
  let total_prizes = 0;
  let total_withdrawals = 0;
  let total_depositos_count = 0;
  let active_leads = 0;
  let awarded_clients_count = 0;
  for (const lead of leads) {
    total_deposited += Number(lead.total_depositado) || 0;
    const apostado = Number(lead.total_apostado) ?? (Number(lead.total_apostado_loteria) || 0) + (Number(lead.total_apostado_bichao) || 0);
    total_bets += apostado;
    total_prizes += Number(lead.total_ganho) || 0;
    total_withdrawals += Number(lead.total_saque) || 0;
    total_depositos_count += parseInt(String(lead.total_depositos_count || 0), 10) || 0;
    if (lead.status === 'ativo' || lead.status === 'active' || lead.status === 'deposito') active_leads += 1;
    if ((Number(lead.total_ganho) || 0) > 0) awarded_clients_count += 1;
  }
  const total_leads = leads.length;
  const conversion_rate = total_leads > 0 ? (active_leads / total_leads) * 100 : 0;
  const net_profit = total_deposited - total_prizes;
  const ltv_avg = active_leads > 0 ? total_deposited / active_leads : 0;
  return {
    total_leads,
    total_deposited,
    total_bets,
    total_prizes,
    total_withdrawals,
    awarded_clients_count,
    total_depositos_count,
    active_leads,
    conversion_rate,
    ltv_avg,
    net_profit,
  };
}

export interface DashboardDataFromIndicatedsParams {
  bancaUrl: string;
  bancaId: string;
  bancaName?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Se informado, carrega gerentes como subordinados do dono (enroller = donoId). Senão, usa user_bancas da banca. */
  donoId?: string | null;
  metaActiveOnly?: boolean;
}

/**
 * Monta o payload completo do dashboard usando APENAS a resposta de get-indicateds-by-consultant.
 * Usado pelo gestor-trafego (independente de dono-banca). Uma única requisição ao endpoint.
 */
export async function getDashboardDataFromIndicatedsOnly(
  params: DashboardDataFromIndicatedsParams
): Promise<{
  bancaId?: string;
  bancaInfo: { name: string | null; url: string | null };
  chartData: Record<string, unknown>;
  externalMetrics: ExternalMetricsShape | null;
  externalMetricsError: string | null;
  gerentes: any[];
  top5Consultants: { name: string; value: number }[];
  metaFunnel: Awaited<ReturnType<typeof getMetaInsightsAggregated>> | null;
  metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>>;
}> {
  const { bancaUrl, bancaId, bancaName, dateFrom, dateTo, donoId, metaActiveOnly = true } = params;
  const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
  const bancaNameResolved = bancaName ?? bancaUrl ?? 'Banca';

  let indicateds: IndicatedLead[] = [];
  try {
    indicateds = await fetchIndicatedsByPeriod(cleanBancaUrl, dateFrom, dateTo);
    crmServiceVerboseLog('[GestorTrafego/IndicatedsOnly] Indicados no período:', indicateds.length);
  } catch (err: any) {
    console.warn('[GestorTrafego/IndicatedsOnly] Erro ao buscar indicados:', err?.message);
    let metaFunnel = null;
    let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
    try {
      [metaFunnel, metaCampaignsData] = await Promise.all([
        getMetaInsightsAggregated(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
        getMetaCampaignsWithInsights(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
      ]);
    } catch (_) {}
    return {
      bancaId,
      bancaInfo: { name: bancaNameResolved, url: bancaUrl },
      chartData: {},
      externalMetrics: null,
      externalMetricsError: 'Erro ao buscar dados do endpoint get-indicateds-by-consultant.',
      gerentes: [],
      top5Consultants: [],
      metaFunnel,
      metaCampaignsData,
    };
  }

  const externalMetrics = computeExternalMetricsFromLeads(indicateds);
  const metricsByConsultantEmail = aggregateIndicatedsByConsultant(indicateds);

  const allConsultantsData: Array<{ id: string; email: string; name: string; total_deposited: number; total_leads: number; net_profit: number }> = [];
  let gerentesComMetricas: any[] = [];

  if (donoId) {
    const { data: gerentes } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('enroller', donoId)
      .eq('status', 'gerente');
    for (const gerente of gerentes || []) {
      const gerenteSubordinateIds = await getSubordinateIds(gerente.id);
      const { data: gerenteConsultants } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .in('id', gerenteSubordinateIds)
        .eq('status', 'consultor');
      const consultorsCount = gerenteConsultants?.length || 0;
      let gerenteMetrics = { total_leads: 0, total_deposited: 0, total_bets: 0, total_prizes: 0, active_leads: 0, net_profit: 0, conversion_rate: 0, total_depositos_count: 0 };
      const consultantsFiltered = (gerenteConsultants || []).filter((c: any) => c.email);
      for (const consultor of consultantsFiltered) {
        const metrics = metricsByConsultantEmail.get(consultor.email) ?? EMPTY_CONSULTANT_METRICS;
        gerenteMetrics.total_leads += metrics.total_leads;
        gerenteMetrics.total_deposited += metrics.total_deposited;
        gerenteMetrics.total_bets += metrics.total_bets;
        gerenteMetrics.total_prizes += metrics.total_prizes;
        gerenteMetrics.active_leads += metrics.active_leads;
        gerenteMetrics.net_profit += metrics.net_profit;
        gerenteMetrics.total_depositos_count += metrics.total_depositos_count;
        allConsultantsData.push({
          id: consultor.id,
          email: consultor.email,
          name: consultor.full_name || consultor.email,
          total_deposited: metrics.total_deposited,
          total_leads: metrics.total_leads,
          net_profit: metrics.net_profit,
        });
      }
      gerenteMetrics.conversion_rate = gerenteMetrics.total_leads > 0 ? (gerenteMetrics.active_leads / gerenteMetrics.total_leads) * 100 : 0;
      let consultoresEmOutrasBancas: Array<{ id: string; email: string; full_name: string | null }> = [];
      if ((gerenteConsultants || []).length > 0) {
        const consultantIds = (gerenteConsultants || []).map((c: { id: string }) => c.id);
        const { data: ubRows } = await supabaseServiceRole
          .from('user_bancas')
          .select('user_id, banca_ids')
          .in('user_id', consultantIds);
        const userIdsInThisBanca = new Set(
          (ubRows || []).filter((r: { user_id: string; banca_ids: string[] }) => Array.isArray(r.banca_ids) && r.banca_ids.includes(bancaId)).map((r: { user_id: string }) => r.user_id)
        );
        consultoresEmOutrasBancas = (gerenteConsultants || []).filter((c: { id: string }) => !userIdsInThisBanca.has(c.id)).map((c: { id: string; email: string; full_name: string | null }) => ({ id: c.id, email: c.email, full_name: c.full_name }));
      }
      gerentesComMetricas.push({
        ...gerente,
        consultoresEmOutrasBancas,
        metrics: {
          campaigns: 0,
          contacts: gerenteMetrics.total_leads,
          processed: gerenteMetrics.total_leads,
          failed: 0,
          consultorsCount,
          successRate: gerenteMetrics.conversion_rate.toFixed(2),
          externalKpis: {
            total_leads: gerenteMetrics.total_leads,
            total_deposited: gerenteMetrics.total_deposited,
            total_bets: gerenteMetrics.total_bets,
            total_prizes: gerenteMetrics.total_prizes,
            active_leads: gerenteMetrics.active_leads,
            net_profit: gerenteMetrics.net_profit,
            conversion_rate: gerenteMetrics.conversion_rate,
            total_depositos_count: gerenteMetrics.total_depositos_count,
          },
        },
      });
    }
  } else {
    const { data: userBancas } = await supabaseServiceRole.from('user_bancas').select('user_id').filter('banca_ids', 'cs', JSON.stringify([bancaId]));
    const userIdsInBanca = (userBancas || []).map((r: { user_id: string }) => r.user_id);
    if (userIdsInBanca.length === 0) {
      gerentesComMetricas = [];
    } else {
      const { data: profilesInBanca } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller')
        .in('id', userIdsInBanca);
      const gerentesProfiles = (profilesInBanca || []).filter((p: { status: string }) => p.status === 'gerente');
      const consultoresInBanca = (profilesInBanca || []).filter((p: { status: string }) => p.status === 'consultor');
      const consultoresByEnroller = new Map<string, any[]>();
      const consultoresSemGerente: any[] = [];
      const gerenteIdsToProcess = new Set<string>(gerentesProfiles.map((g: { id: string }) => g.id));
      for (const c of consultoresInBanca) {
        if (c.enroller) {
          const { data: enr } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', c.enroller).single();
          if (enr?.status === 'gerente') {
            gerenteIdsToProcess.add(enr.id);
            if (!consultoresByEnroller.has(c.enroller)) consultoresByEnroller.set(c.enroller, []);
            consultoresByEnroller.get(c.enroller)!.push(c);
          } else consultoresSemGerente.push(c);
        } else consultoresSemGerente.push(c);
      }
      for (const g of gerentesProfiles) {
        const subIds = await getSubordinateIds(g.id);
        const subsInBanca = (profilesInBanca || []).filter((p: any) => subIds.includes(p.id) && p.status === 'consultor');
        const existing = consultoresByEnroller.get(g.id) || [];
        const merged = [...existing];
        for (const s of subsInBanca) {
          if (!merged.some((m: any) => m.id === s.id)) merged.push(s);
        }
        consultoresByEnroller.set(g.id, merged);
      }
      if (consultoresSemGerente.length > 0) {
        gerenteIdsToProcess.add('__consultores_diretos__');
        consultoresByEnroller.set('__consultores_diretos__', consultoresSemGerente);
      }
      const gerentesToShow: Array<{ gerente: any; consultants: any[] }> = [];
      for (const gerenteId of gerenteIdsToProcess) {
        const consultants = consultoresByEnroller.get(gerenteId) || [];
        if (gerenteId === '__consultores_diretos__') {
          gerentesToShow.push({
            gerente: { id: '__consultores_diretos__', email: '', full_name: 'Consultores diretos (sem gerente)', status: 'consultor' },
            consultants,
          });
        } else {
          const gerenteFromBanca = gerentesProfiles.find((g: { id: string }) => g.id === gerenteId);
          let gerenteProfile = gerenteFromBanca;
          if (!gerenteProfile) {
            const { data: profileData } = await supabaseServiceRole.from('profiles').select('id, email, full_name, status, enroller').eq('id', gerenteId).single();
            gerenteProfile = profileData ?? undefined;
          }
          if (gerenteProfile) gerentesToShow.push({ gerente: gerenteProfile, consultants });
        }
      }
      // Consultores em outras bancas: por gerente, subordinados que não têm esta banca em banca_ids
      const consultoresEmOutrasBancasByGerente = new Map<string, Array<{ id: string; email: string; full_name: string | null }>>();
      for (const { gerente } of gerentesToShow) {
        if (gerente.id === '__consultores_diretos__') continue;
        const subIds = await getSubordinateIds(gerente.id);
        if (subIds.length === 0) continue;
        const { data: subProfiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, email, full_name, status')
          .in('id', subIds)
          .eq('status', 'consultor');
        const consultantIds = (subProfiles || []).map((p: { id: string }) => p.id);
        if (consultantIds.length === 0) continue;
        const { data: ubRows } = await supabaseServiceRole
          .from('user_bancas')
          .select('user_id, banca_ids')
          .in('user_id', consultantIds);
        const userIdsInThisBanca = new Set(
          (ubRows || [])
            .filter((r: { user_id: string; banca_ids: string[] }) => Array.isArray(r.banca_ids) && r.banca_ids.includes(bancaId))
            .map((r: { user_id: string }) => r.user_id)
        );
        const notInBancaIds = consultantIds.filter((id: string) => !userIdsInThisBanca.has(id));
        const consultantsNotInBanca = (subProfiles || []).filter((p: { id: string }) => notInBancaIds.includes(p.id));
        if (consultantsNotInBanca.length > 0) {
          consultoresEmOutrasBancasByGerente.set(gerente.id, consultantsNotInBanca.map((p: { id: string; email: string; full_name: string | null }) => ({ id: p.id, email: p.email, full_name: p.full_name })));
        }
      }

      for (const { gerente, consultants: gerenteConsultants } of gerentesToShow) {
        const consultorsCount = gerenteConsultants?.length || 0;
        let gerenteMetrics = { total_leads: 0, total_deposited: 0, total_bets: 0, total_prizes: 0, active_leads: 0, net_profit: 0, conversion_rate: 0, total_depositos_count: 0 };
        const consultantsFiltered = (gerenteConsultants || []).filter((c: any) => c.email);
        for (const consultor of consultantsFiltered) {
          const metrics = metricsByConsultantEmail.get(consultor.email) ?? EMPTY_CONSULTANT_METRICS;
          gerenteMetrics.total_leads += metrics.total_leads;
          gerenteMetrics.total_deposited += metrics.total_deposited;
          gerenteMetrics.total_bets += metrics.total_bets;
          gerenteMetrics.total_prizes += metrics.total_prizes;
          gerenteMetrics.active_leads += metrics.active_leads;
          gerenteMetrics.net_profit += metrics.net_profit;
          gerenteMetrics.total_depositos_count += metrics.total_depositos_count;
          allConsultantsData.push({
            id: consultor.id,
            email: consultor.email,
            name: consultor.full_name || consultor.email,
            total_deposited: metrics.total_deposited,
            total_leads: metrics.total_leads,
            net_profit: metrics.net_profit,
          });
        }
        gerenteMetrics.conversion_rate = gerenteMetrics.total_leads > 0 ? (gerenteMetrics.active_leads / gerenteMetrics.total_leads) * 100 : 0;
        const consultoresEmOutrasBancas = gerente.id !== '__consultores_diretos__' ? (consultoresEmOutrasBancasByGerente.get(gerente.id) || []) : [];
        gerentesComMetricas.push({
          ...gerente,
          consultoresEmOutrasBancas,
          metrics: {
            campaigns: 0,
            contacts: gerenteMetrics.total_leads,
            processed: gerenteMetrics.total_leads,
            failed: 0,
            consultorsCount,
            successRate: gerenteMetrics.conversion_rate.toFixed(2),
            externalKpis: {
              total_leads: gerenteMetrics.total_leads,
              total_deposited: gerenteMetrics.total_deposited,
              total_bets: gerenteMetrics.total_bets,
              total_prizes: gerenteMetrics.total_prizes,
              active_leads: gerenteMetrics.active_leads,
              net_profit: gerenteMetrics.net_profit,
              conversion_rate: gerenteMetrics.conversion_rate,
              total_depositos_count: gerenteMetrics.total_depositos_count,
            },
          },
        });
      }
    }
  }

  const top5FromMap = Array.from(metricsByConsultantEmail.entries())
    .filter(([, m]) => m.total_deposited > 0)
    .sort((a, b) => b[1].total_deposited - a[1].total_deposited)
    .slice(0, 5)
    .map(([, m]) => ({ name: m.consultant_name || 'Consultor', value: m.total_deposited }));
  const top5Consultants = top5FromMap.length > 0 ? top5FromMap : allConsultantsData
    .filter(c => c.total_deposited > 0)
    .sort((a, b) => b.total_deposited - a.total_deposited)
    .slice(0, 5)
    .map(c => ({ name: c.name, value: c.total_deposited }));

  let metaFunnel = null;
  let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
  try {
    [metaFunnel, metaCampaignsData] = await Promise.all([
      getMetaInsightsAggregated(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
      getMetaCampaignsWithInsights(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
    ]);
  } catch (_) {}

  return {
    bancaId,
    bancaInfo: { name: bancaNameResolved, url: bancaUrl },
    chartData: {},
    externalMetrics,
    externalMetricsError: null,
    gerentes: gerentesComMetricas,
    top5Consultants,
    metaFunnel,
    metaCampaignsData,
  };
}

/** Lê corpo de erro do CRM para log (truncado, sem expor segredos). */
async function readCrmErrorBody(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return '(body vazio)';
    try {
      const parsed = JSON.parse(text);
      const serialized = JSON.stringify(parsed);
      return serialized.length > 800 ? `${serialized.slice(0, 800)}…` : serialized;
    } catch {
      return text.length > 800 ? `${text.slice(0, 800)}…` : text;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `(falha ao ler body: ${message})`;
  }
}

async function logCrmFetchFailure(
  label: string,
  res: Response,
  context: { url: string; hasApiKey: boolean; durationMs: number; extra?: Record<string, unknown> }
): Promise<void> {
  const body = await readCrmErrorBody(res);
  const hint =
    res.status === 401
      ? 'Verifique CRM_API_KEY no .env e se a chave está válida no CRM da banca.'
      : res.status === 403
        ? 'Chave presente, mas sem permissão para este endpoint.'
        : undefined;
  console.warn(`[DonoBanca Service] ${label} falhou`, {
    status: res.status,
    statusText: res.statusText,
    durationMs: context.durationMs,
    url: context.url,
    hasApiKey: context.hasApiKey,
    apiKeyLength: context.hasApiKey ? process.env.CRM_API_KEY?.length ?? 0 : 0,
    contentType: res.headers.get('content-type'),
    ...(hint ? { hint } : {}),
    ...(context.extra ?? {}),
    body,
  });
}

/**
 * Cache em memória de dashboard-metrics por (banca, range). TTL curto: evita re-bater na CRM
 * quando ranking + card (ou o double-render do React StrictMode em dev) pedem o mesmo dado
 * em sequência. Ajustável via env para tuning.
 */
const DASHBOARD_METRICS_CACHE_TTL_MS = (() => {
  const raw = parseInt(String(process.env.DASHBOARD_METRICS_CACHE_TTL_MS ?? '').trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 10 * 60_000) return raw;
  return 30_000;
})();

/** Entradas vencidas ficam disponíveis como "último valor conhecido" por até este prazo. */
const DASHBOARD_METRICS_STALE_MAX_MS = 6 * 60 * 60 * 1000;

type DashboardMetricsCacheEntry = {
  value: ExternalMetricsShape;
  /** Até quando a entrada é considerada fresca (cache HIT direto). */
  freshUntil: number;
  /** Quando o valor foi obtido — limita o uso como fallback stale. */
  fetchedAt: number;
};

const dashboardMetricsCache = new Map<string, DashboardMetricsCacheEntry>();
/** Requisições em voo por (banca, range): chamadas concorrentes compartilham o mesmo fetch. */
const dashboardMetricsInflight = new Map<string, Promise<ExternalMetricsShape | null>>();

function dashboardMetricsCacheKey(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): string {
  return `${cleanBancaUrl}|${dateFrom ?? ''}|${dateTo ?? ''}`;
}

function pruneDashboardMetricsCache(): void {
  if (dashboardMetricsCache.size < 200) return;
  const now = Date.now();
  for (const [key, entry] of dashboardMetricsCache) {
    if (now - entry.fetchedAt > DASHBOARD_METRICS_STALE_MAX_MS) dashboardMetricsCache.delete(key);
  }
}

/**
 * Último valor conhecido de dashboard-metrics para (banca, range), mesmo que o TTL fresco
 * tenha vencido. Fallback para CRMs lentas (ex.: LotoX ~22s) que estouram o timeout do
 * ranking: a requisição compartilhada termina depois e aquece o cache; na próxima montagem
 * o ranking usa este valor em vez de marcar "CRM indisponível". Limitado a 6h de idade.
 */
export function peekDashboardMetricsLastKnown(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): ExternalMetricsShape | null {
  const entry = dashboardMetricsCache.get(dashboardMetricsCacheKey(cleanBancaUrl, dateFrom, dateTo));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > DASHBOARD_METRICS_STALE_MAX_MS) return null;
  return entry.value;
}

/**
 * Aguarda `promise`, mas rejeita com AbortError se o `signal` do caller abortar antes.
 * A promise subjacente (fetch compartilhado) NÃO é cancelada — outros callers continuam
 * aguardando e o resultado ainda aquece o cache.
 */
function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Busca dashboard-metrics com dedup + cache:
 * - Chamadas concorrentes à mesma (banca, range) compartilham UMA requisição HTTP — evita que
 *   CRMs lentas (ex.: LotoX ~20s) sejam atingidas em duplicidade e congestionem o processo,
 *   atrasando bancas rápidas além do timeout do ranking.
 * - Sucesso entra em cache curto (TTL acima); falha não é cacheada (próxima chamada tenta de novo).
 * - O `signal` do caller só desiste da ESPERA (AbortError, contrato preservado); a requisição
 *   compartilhada segue até completar e aquece o cache para a próxima chamada.
 */
export async function fetchDashboardMetrics(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  signal?: AbortSignal
): Promise<ExternalMetricsShape | null> {
  throwIfAborted(signal);
  const key = dashboardMetricsCacheKey(cleanBancaUrl, dateFrom, dateTo);

  const cached = dashboardMetricsCache.get(key);
  if (cached && cached.freshUntil > Date.now()) {
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics cache HIT:', { url: cleanBancaUrl, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null });
    return cached.value;
  }

  let inflight = dashboardMetricsInflight.get(key);
  if (inflight) {
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics dedup (compartilhando requisição em voo):', { url: cleanBancaUrl, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null });
  } else {
    inflight = fetchDashboardMetricsUncached(cleanBancaUrl, dateFrom, dateTo)
      .then((value) => {
        if (value) {
          pruneDashboardMetricsCache();
          dashboardMetricsCache.set(key, {
            value,
            freshUntil: Date.now() + DASHBOARD_METRICS_CACHE_TTL_MS,
            fetchedAt: Date.now(),
          });
        }
        return value;
      })
      .finally(() => {
        dashboardMetricsInflight.delete(key);
      });
    dashboardMetricsInflight.set(key, inflight);
  }

  return raceWithSignal(inflight, signal);
}

async function fetchDashboardMetricsUncached(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<ExternalMetricsShape | null> {
  let requestUrl: string | null = null;
  try {
    const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
    if (dateFrom) externalApiUrl.searchParams.append('date_from', dateFrom);
    if (dateTo) externalApiUrl.searchParams.append('date_to', dateTo);
    const apiKey = process.env.CRM_API_KEY;
    requestUrl = externalApiUrl.toString();

    // Retry com espera aleatória (1s–3s) quando a CRM responde 429 (Too Many Attempts).
    // O request em si funciona (confirmado no Postman); o 429 vem de chamadas muito próximas.
    let res: Response;
    let durationMs = 0;
    let attempt = 0;
    while (true) {
      await crmThrottleGate();
      const startTime = Date.now();
      res = await fetch(requestUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: getCrmFetchSignal(null),
      });
      durationMs = Date.now() - startTime;
      if (res.status !== 429 || attempt >= DASHBOARD_METRICS_429_MAX_RETRIES) break;
      attempt++;
      // Honra Retry-After; senão backoff crescente com jitter (~2s, 4s… até 10s).
      const waitMs = parseRetryAfterMs(res) ?? Math.min(10000, randomDelayMs(1500, 3000) * attempt);
      crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics 429 — aguardando para retry:', {
        url: requestUrl,
        attempt,
        maxRetries: DASHBOARD_METRICS_429_MAX_RETRIES,
        waitMs,
      });
      await sleep(waitMs);
    }

    const logContext = {
      url: requestUrl,
      hasApiKey: Boolean(apiKey),
      durationMs,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      ...(attempt > 0 ? { retries: attempt } : {}),
    };
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics status:', res.status, `(${durationMs}ms, retries: ${attempt})`, {
      url: requestUrl,
      hasApiKey: Boolean(apiKey),
    });
    if (!res.ok) {
      await logCrmFetchFailure('dashboard-metrics', res, logContext);
      return null;
    }
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      await logCrmFetchFailure('dashboard-metrics (content-type inválido)', res, {
        ...logContext,
        extra: { expectedContentType: 'application/json', receivedContentType: contentType },
      });
      return null;
    }
    const externalData = await res.json();
    const externalRootKeys = externalData && typeof externalData === 'object'
      ? Object.keys(externalData as Record<string, unknown>)
      : [];
    let metrics: any = null;
    if (externalData?.success && externalData.metrics) metrics = externalData.metrics;
    else if (externalData?.metrics) metrics = externalData.metrics;
    else if (externalData?.total_leads !== undefined || externalData?.total_deposited !== undefined) metrics = externalData;
    const metricsKeys = metrics && typeof metrics === 'object'
      ? Object.keys(metrics as Record<string, unknown>)
      : [];
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics payload fields:', {
      rootKeys: externalRootKeys,
      metricsKeys,
      hasSuccessFlag: Boolean(externalData?.success),
      hasMetricsObject: Boolean(externalData?.metrics),
    });
    if (!metrics) {
      console.warn('[DonoBanca Service] dashboard-metrics resposta OK, mas sem métricas reconhecíveis', {
        ...logContext,
        rootKeys: externalRootKeys,
        metricsKeys,
      });
      return null;
    }
    const normalizedMetrics = {
      total_leads: Number(metrics.total_leads) || 0,
      total_deposited: Number(metrics.total_deposited) || 0,
      total_bets: Number(metrics.total_bets) || 0,
      total_prizes: Number(metrics.total_prizes) || 0,
      total_withdrawals: Number(metrics.total_withdrawals) || Number(metrics.total_prizes) || 0,
      awarded_clients_count: Number(metrics.awarded_clients_count) || 0,
      total_depositos_count: Number(metrics.total_depositos_count) || 0,
      active_leads: Number(metrics.active_leads) || 0,
      conversion_rate: Number(metrics.conversion_rate) || 0,
      ltv_avg: Number(metrics.ltv_avg) || 0,
      net_profit: Number(metrics.net_profit) || (Number(metrics.total_deposited) || 0) - (Number(metrics.total_prizes) || 0),
    };
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics normalized snapshot:', normalizedMetrics);
    return normalizedMetrics;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.warn('[DonoBanca Service] Erro ao buscar dashboard-metrics:', {
      message,
      url: requestUrl ?? `${cleanBancaUrl}/api/crm/dashboard-metrics`,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      hasApiKey: Boolean(process.env.CRM_API_KEY),
      ...(stack ? { stack } : {}),
    });
    return null;
  }
}

/**
 * Métricas RECORRENTES da banca (todas as recargas/transações no período, não só
 * primeiro depósito). Fonte: CRM `/api/crm/extract-totals?date_from=&date_to=`.
 */
export interface ExtractTotalsShape {
  recarga_pix: number;
  recarga_manual: number;
  total_recargas: number;
  total_bonus: number;
  bonus_afiliado: number;
  bonus_estrelas: number;
  apostas_loterias: number;
  apostas_jogo_do_bicho: number;
  premios_loterias: number;
  premios_jb: number;
  venda_combo_total: number;
  venda_bolao_total: number;
  solicitacao_saque: number;
  total_saque_disponivel: number;
  total_balance: number;
  total_transacts: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchExtractTotals(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  signal?: AbortSignal
): Promise<ExtractTotalsShape | null> {
  throwIfAborted(signal);
  let requestUrl: string | null = null;
  try {
    const apiUrl = new URL(`${cleanBancaUrl}/api/crm/extract-totals`);
    if (dateFrom) apiUrl.searchParams.append('date_from', dateFrom);
    if (dateTo) apiUrl.searchParams.append('date_to', dateTo);
    const apiKey = process.env.CRM_API_KEY;
    requestUrl = apiUrl.toString();

    // Retry de 429 com Retry-After + backoff (mesmo tratamento do dashboard-metrics).
    let res: Response;
    let attempt = 0;
    while (true) {
      await crmThrottleGate(signal);
      res = await fetch(requestUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: getCrmFetchSignal(signal),
      });
      if (res.status !== 429 || attempt >= DASHBOARD_METRICS_429_MAX_RETRIES) break;
      attempt++;
      const waitMs = parseRetryAfterMs(res) ?? Math.min(10000, randomDelayMs(1500, 3000) * attempt);
      crmServiceVerboseLog('[DonoBanca Service] extract-totals 429 — aguardando para retry:', {
        url: requestUrl,
        attempt,
        waitMs,
      });
      await sleep(waitMs);
    }

    if (!res.ok) {
      await logCrmFetchFailure('extract-totals', res, {
        url: requestUrl,
        hasApiKey: Boolean(apiKey),
        durationMs: 0,
        extra: { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null, ...(attempt > 0 ? { retries: attempt } : {}) },
      });
      return null;
    }
    const json = await res.json();
    const t = json?.totals;
    if (!t || typeof t !== 'object') {
      console.warn('[DonoBanca Service] extract-totals OK, mas sem objeto totals');
      return null;
    }
    return {
      recarga_pix: num(t.recarga_pix),
      recarga_manual: num(t.recarga_manual),
      total_recargas: num(t.total_recargas),
      total_bonus: num(t.total_bonus),
      bonus_afiliado: num(t.bonus_afiliado),
      bonus_estrelas: num(t.bonus_estrelas),
      apostas_loterias: num(t.apostas_loterias),
      apostas_jogo_do_bicho: num(t.apostas_jogo_do_bicho),
      premios_loterias: num(t.premios_loterias),
      premios_jb: num(t.premios_jb),
      venda_combo_total: num(t.venda_combo?.total),
      venda_bolao_total: num(t.venda_bolao?.total),
      solicitacao_saque: num(t.solicitacao_saque),
      total_saque_disponivel: num(t.total_saque_disponivel),
      total_balance: num(t.total_balance),
      total_transacts: num(t.total_transacts),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.warn('[DonoBanca Service] Erro ao buscar extract-totals:', {
      message: err instanceof Error ? err.message : String(err),
      url: requestUrl ?? `${cleanBancaUrl}/api/crm/extract-totals`,
    });
    return null;
  }
}

/**
 * Cohort de jogadores reais (LTV recorrente por jogador/consultor).
 * Fonte: CRM `/api/crm/cohort-real-players` — registrados em [cohort] que depositaram
 * em [deposit_window]. Aqui cohort = deposit_window = período selecionado.
 */
export interface CohortPlayer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string | null;
  consultant_id: number | null;
  consultant_name: string | null;
  consultant_email: string | null;
  deposited_in_window: number;
  deposits_count_in_window: number;
  ltv_in_window: number;
  ltv_count_in_window: number;
  deposit_bucket: string | null;
  last_deposit_at: string | null;
  last_deposit_value: number | null;
}

export interface CohortTotals {
  cohort_size: number;
  total_deposited_in_window: number;
  total_deposits_count_in_window: number;
  players_that_deposited: number;
  total_ltv_in_window: number;
  players_with_ltv: number;
  ltv_avg: number;
  deposit_buckets: { dep_1x: number; dep_2x: number; dep_3x: number; dep_4x_plus: number };
}

export interface CohortRealPlayersResult {
  totals: CohortTotals | null;
  data: CohortPlayer[];
}

export async function fetchCohortRealPlayers(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  signal?: AbortSignal
): Promise<CohortRealPlayersResult | null> {
  throwIfAborted(signal);
  const perPage = 1000;
  const maxPages = 20;
  const allData: CohortPlayer[] = [];
  let totals: CohortTotals | null = null;
  const apiKey = process.env.CRM_API_KEY;

  for (let page = 1; page <= maxPages; page++) {
    throwIfAborted(signal);
    const apiUrl = new URL(`${cleanBancaUrl}/api/crm/cohort-real-players`);
    if (dateFrom) {
      apiUrl.searchParams.set('cohort_from', dateFrom);
      apiUrl.searchParams.set('deposit_from', dateFrom);
    }
    if (dateTo) {
      apiUrl.searchParams.set('cohort_to', dateTo);
      apiUrl.searchParams.set('deposit_to', dateTo);
    }
    apiUrl.searchParams.set('per_page', String(perPage));
    apiUrl.searchParams.set('page', String(page));
    const requestUrl = apiUrl.toString();

    // Retry de 429 com backoff crescente + Retry-After (throttle do CRM é agressivo nesta rota).
    let res: Response;
    let attempt = 0;
    while (true) {
      await crmThrottleGate(signal);
      res = await fetch(requestUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: getCrmFetchSignal(signal, COHORT_FETCH_TIMEOUT_MS),
      });
      if (res.status !== 429 || attempt >= COHORT_429_MAX_RETRIES) break;
      attempt++;
      // Honra Retry-After; senão backoff crescente (~2s, 4s, 6s…) com jitter, até 10s.
      const retryAfter = parseRetryAfterMs(res);
      const backoff = Math.min(10000, randomDelayMs(1500, 3000) * attempt);
      await sleep(retryAfter ?? backoff);
    }

    if (!res.ok) {
      await logCrmFetchFailure('cohort-real-players', res, {
        url: requestUrl,
        hasApiKey: Boolean(apiKey),
        durationMs: 0,
        extra: { page, ...(attempt > 0 ? { retries: attempt } : {}) },
      });
      break;
    }
    const json = await res.json().catch(() => null);
    if (page === 1 && json?.totals && typeof json.totals === 'object') {
      const t = json.totals;
      const b = t.deposit_buckets ?? {};
      totals = {
        cohort_size: num(t.cohort_size),
        total_deposited_in_window: num(t.total_deposited_in_window),
        total_deposits_count_in_window: num(t.total_deposits_count_in_window),
        players_that_deposited: num(t.players_that_deposited),
        total_ltv_in_window: num(t.total_ltv_in_window),
        players_with_ltv: num(t.players_with_ltv),
        ltv_avg: num(t.ltv_avg),
        deposit_buckets: {
          dep_1x: num(b.dep_1x),
          dep_2x: num(b.dep_2x),
          dep_3x: num(b.dep_3x),
          dep_4x_plus: num(b.dep_4x_plus),
        },
      };
    }
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const r of rows) {
      allData.push({
        id: num(r.id),
        name: r.name ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        registered_at: r.registered_at ?? null,
        consultant_id: r.consultant_id != null ? num(r.consultant_id) : null,
        consultant_name: r.consultant_name ?? null,
        consultant_email: r.consultant_email ?? null,
        deposited_in_window: num(r.deposited_in_window),
        deposits_count_in_window: num(r.deposits_count_in_window),
        ltv_in_window: num(r.ltv_in_window),
        ltv_count_in_window: num(r.ltv_count_in_window),
        deposit_bucket: r.deposit_bucket ?? null,
        last_deposit_at: r.last_deposit_at ?? null,
        last_deposit_value: r.last_deposit_value != null ? num(r.last_deposit_value) : null,
      });
    }
    if (rows.length < perPage) break;
  }

  return { totals, data: allData };
}

export async function getDonoBancaDashboardData({
  userId,
  dateFrom,
  dateTo,
  metaActiveOnly = true,
  skipMeta = false,
  skipExternalMetrics = false,
  gerentesOffset: rawGerentesOffset,
  gerentesLimit: rawGerentesLimit,
  signal,
}: DonoBancaDashboardParams) {
  throwIfAborted(signal);
  // Busca informações do dono de banca (incluindo banca_url)
  const { data: donoProfile } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, banca_url, banca_name, status')
    .eq('id', userId)
    .single();

  if (!donoProfile || donoProfile.status !== 'dono_banca') {
    throw new Error('Acesso negado. Perfil não encontrado ou não é dono de banca.');
  }

  const cleanBancaUrl = donoProfile.banca_url ? normalizeBancaUrl(donoProfile.banca_url) : null;

  const paginateGerentes =
    rawGerentesLimit !== undefined && rawGerentesLimit !== null && Number.isFinite(Number(rawGerentesLimit));
  const goffset = Math.max(0, rawGerentesOffset ?? 0);
  const glimit = paginateGerentes ? Math.min(Math.max(Number(rawGerentesLimit), 1), 1000) : Number.POSITIVE_INFINITY;

  const loadHeaderMetrics = (!paginateGerentes || goffset === 0) && !skipExternalMetrics;

  // Bancas + métricas (só primeira página se paginado) + gerentes em paralelo (sem indicados ainda)
  const [bancasDono, externalMetricsRaw, gerentesResult] = await Promise.all([
    supabaseServiceRole.from('crm_bancas').select('id, url'),
    loadHeaderMetrics && cleanBancaUrl ? fetchDashboardMetrics(cleanBancaUrl, dateFrom, dateTo, signal) : Promise.resolve(null),
    supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('enroller', userId)
      .eq('status', 'gerente'),
  ]);

  const gerentes = gerentesResult.data || [];
  const totalGerentesCount = gerentes.length;
  const gerentesPage = paginateGerentes ? gerentes.slice(goffset, goffset + glimit) : gerentes;
  const hasMoreGerentes = paginateGerentes ? goffset + gerentesPage.length < totalGerentesCount : false;

  // Mesma forma que o CRM: buscar indicados por consultant=email — apenas para gerentes desta página (evita timeout na Netlify)
  let indicatedsRaw: IndicatedLead[] = [];
  let consultoresPage: Array<{ id: string; email: string; full_name: string | null; enroller: string | null }> = [];
  if (cleanBancaUrl && gerentesPage.length > 0) {
    const consultantEmails: string[] = [];
    for (const g of gerentesPage) {
      if (g.email?.trim()) consultantEmails.push(g.email.trim());
    }
    const gerenteIds = gerentesPage.map((g: { id: string }) => g.id);
    const { data: consultores } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, enroller')
      .in('enroller', gerenteIds)
      .eq('status', 'consultor');
    consultoresPage = consultores || [];
    if (consultoresPage.length) {
      for (const c of consultoresPage) {
        if (c.email?.trim()) consultantEmails.push(c.email.trim());
      }
    }
    if (consultantEmails.length > 0) {
      indicatedsRaw = await fetchIndicatedsByConsultants(cleanBancaUrl, dateFrom, dateTo, consultantEmails, signal).catch((err: any) => {
        if (err?.name === 'AbortError') throw err;
        console.warn('[DonoBanca Service] Erro ao buscar indicados por consultor:', err?.message);
        return [] as IndicatedLead[];
      });
    }
  }

  const bancaMatchDono = (bancasDono.data || []).find(
    (b: { url: string }) => normalizeBancaUrl(b.url) === normalizeBancaUrl(donoProfile?.banca_url ?? '')
  );
  const bancaIdDono = bancaMatchDono?.id;
  let externalMetrics: ExternalMetricsShape | null = externalMetricsRaw;

  if (externalMetrics) {
    crmServiceVerboseLog('[DonoBanca Service] dashboard-metrics recebidas. total_leads:', externalMetrics.total_leads);
  }
  crmServiceVerboseLog('[DonoBanca Service] Gerentes encontrados:', gerentes?.length || 0);

  // Agrega indicados por consultor para preencher métricas dos gerentes
  const metricsByConsultantEmail = aggregateIndicatedsByConsultant(indicatedsRaw);
  crmServiceVerboseLog('[DonoBanca Service] Indicados agregados por consultor:', metricsByConsultantEmail.size);

  // Dados de gráficos não são mais buscados da API externa
  const chartData = {};

  // Array para coletar dados de TODOS os consultores (independente do gerente)
  const allConsultantsData: Array<{
    id: string;
    email: string;
    name: string;
    total_deposited: number;
    total_leads: number;
    net_profit: number;
  }> = [];

  const consultoresByGerenteId = new Map<string, typeof consultoresPage>();
  for (const c of consultoresPage) {
    if (!c.enroller) continue;
    if (!consultoresByGerenteId.has(c.enroller)) consultoresByGerenteId.set(c.enroller, []);
    consultoresByGerenteId.get(c.enroller)!.push(c);
  }

  const userIdsInThisBancaDono = new Set<string>();
  if (bancaIdDono && consultoresPage.length > 0) {
    const consultantIds = consultoresPage.map((c) => c.id);
    const { data: ubRows } = await supabaseServiceRole
      .from('user_bancas')
      .select('user_id, banca_ids')
      .in('user_id', consultantIds);
    for (const r of ubRows || []) {
      const row = r as { user_id: string; banca_ids: string[] };
      if (Array.isArray(row.banca_ids) && row.banca_ids.includes(bancaIdDono)) {
        userIdsInThisBancaDono.add(row.user_id);
      }
    }
  }

  const gerentesComMetricas = (gerentesPage || []).map((gerente: { id: string; email: string; full_name: string | null }) => {
    const gerenteConsultants = consultoresByGerenteId.get(gerente.id) || [];
    const consultorsCount = gerenteConsultants.length;

    let gerenteMetrics = {
      total_leads: 0,
      total_deposited: 0,
      total_bets: 0,
      total_prizes: 0,
      active_leads: 0,
      net_profit: 0,
      conversion_rate: 0,
      total_depositos_count: 0,
    };

    if (gerenteConsultants.length > 0) {
      const consultantsFiltered = gerenteConsultants.filter((c) => c.email);
      for (const consultor of consultantsFiltered) {
        const metrics = metricsByConsultantEmail.get(consultor.email) ?? EMPTY_CONSULTANT_METRICS;
        gerenteMetrics.total_leads += metrics.total_leads;
        gerenteMetrics.total_deposited += metrics.total_deposited;
        gerenteMetrics.total_bets += metrics.total_bets;
        gerenteMetrics.total_prizes += metrics.total_prizes;
        gerenteMetrics.active_leads += metrics.active_leads;
        gerenteMetrics.net_profit += metrics.net_profit;
        gerenteMetrics.total_depositos_count += metrics.total_depositos_count;
        allConsultantsData.push({
          id: consultor.id,
          email: consultor.email,
          name: consultor.full_name || consultor.email,
          total_deposited: metrics.total_deposited,
          total_leads: metrics.total_leads,
          net_profit: metrics.net_profit,
        });
      }
      gerenteMetrics.conversion_rate = gerenteMetrics.total_leads > 0
        ? (gerenteMetrics.active_leads / gerenteMetrics.total_leads) * 100
        : 0;
    }

    const consultoresEmOutrasBancas =
      bancaIdDono && gerenteConsultants.length > 0
        ? gerenteConsultants
            .filter((c) => !userIdsInThisBancaDono.has(c.id))
            .map((c) => ({ id: c.id, email: c.email, full_name: c.full_name }))
        : [];

    return {
      ...gerente,
      consultoresEmOutrasBancas,
      metrics: {
        campaigns: 0,
        contacts: gerenteMetrics.total_leads,
        processed: gerenteMetrics.total_leads,
        failed: 0,
        consultorsCount,
        successRate: gerenteMetrics.conversion_rate.toFixed(2),
        externalKpis: {
          total_leads: gerenteMetrics.total_leads,
          total_deposited: gerenteMetrics.total_deposited,
          total_bets: gerenteMetrics.total_bets,
          total_prizes: gerenteMetrics.total_prizes,
          active_leads: gerenteMetrics.active_leads,
          net_profit: gerenteMetrics.net_profit,
          conversion_rate: gerenteMetrics.conversion_rate,
          total_depositos_count: gerenteMetrics.total_depositos_count,
        },
      },
    };
  });

  // Total de depósitos (contagem) — só com visão completa de gerentes; em páginas parciais o funil usa só o agregado da API
  if (!paginateGerentes) {
    const sumTotalDepositosCount = gerentesComMetricas.reduce(
      (acc, g) => acc + (g.metrics.externalKpis?.total_depositos_count ?? 0),
      0
    );
    const agregadoDepositosCount = externalMetrics?.total_depositos_count ?? 0;
    crmServiceVerboseLog('[DonoBanca Service] 📦 total_depositos_count (funil):', {
      agregado_api: agregadoDepositosCount,
      soma_consultores: sumTotalDepositosCount,
    });
    if (externalMetrics && (externalMetrics.total_depositos_count ?? 0) === 0 && sumTotalDepositosCount > 0) {
      externalMetrics = { ...externalMetrics, total_depositos_count: sumTotalDepositosCount };
    }
  }

  // ============================================
  // TOP 5 CONSULTORES: Ordena por vendas (total_deposited) e pega os top 5
  // ============================================
  crmServiceVerboseLog('[DonoBanca Service] 📊 Total de consultores coletados:', allConsultantsData.length);
  
  const consultantRankContributors = allConsultantsData.map((c) => ({
    email: c.email,
    name: c.name,
    value: c.total_deposited,
  }));

  const top5Consultants = paginateGerentes
    ? []
    : allConsultantsData
        .filter((c) => c.total_deposited > 0)
        .sort((a, b) => b.total_deposited - a.total_deposited)
        .slice(0, 5)
        .map((c) => ({
          name: c.name,
          value: c.total_deposited,
        }));

  crmServiceVerboseLog('[DonoBanca Service] 🏆 Top 5 Consultores por Vendas:', top5Consultants);

  // Calcula total de consultores para log
  const totalConsultores = gerentesComMetricas.reduce((sum, g) => sum + (g.metrics.consultorsCount || 0), 0);
  
  // Log final resumindo todas as requisições
  crmServiceVerboseLog('[DonoBanca Service] 📋 Resumo das requisições:');
  crmServiceVerboseLog('[DonoBanca Service]   ✅ RESUMO GERAL: Métricas agregadas da banca (sem consultant)');
  crmServiceVerboseLog('[DonoBanca Service]   ✅ TABELA GERENTES: Soma de métricas de todos os consultores (com consultant)');
  crmServiceVerboseLog('[DonoBanca Service]   ✅ Gerentes processados:', gerentesComMetricas.length);
  crmServiceVerboseLog('[DonoBanca Service]   ✅ Total de consultores:', totalConsultores);
  crmServiceVerboseLog('[DonoBanca Service]   ⚡ OTIMIZAÇÃO: Uma única requisição get-indicateds-by-consultant (from/to) → agregado por consultor');
  crmServiceVerboseLog('[DonoBanca Service]   📊 API: /api/crm/get-indicateds-by-consultant');
  crmServiceVerboseLog('[DonoBanca Service]   📅 Filtros aplicados: date_from=' + dateFrom + ', date_to=' + dateTo);
  crmServiceVerboseLog('[DonoBanca Service]   💰 total_depositos_count (para estágio Depósitos do funil):', externalMetrics?.total_depositos_count ?? 'n/a');
  crmServiceVerboseLog('[DonoBanca Service] 🎉 Processamento concluído!');

  let metaFunnel = null;
  let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
  if (bancaIdDono && !skipMeta && (!paginateGerentes || goffset === 0)) {
    try {
      [metaFunnel, metaCampaignsData] = await Promise.all([
        getMetaInsightsAggregated(bancaIdDono, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
        getMetaCampaignsWithInsights(bancaIdDono, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
      ]);
    } catch (metaErr: any) {
      console.warn('[DonoBanca Service] Meta insights não disponíveis:', metaErr?.message);
    }
  }

  return {
    bancaId: bancaIdDono ?? undefined,
    bancaInfo: {
      name: donoProfile?.banca_name || null,
      url: donoProfile?.banca_url || null,
    },
    chartData,
    externalMetrics: externalMetrics,
    externalMetricsError:
      loadHeaderMetrics && !externalMetrics && donoProfile?.banca_url ? 'Erro ao buscar métricas da API externa' : null,
    gerentes: gerentesComMetricas,
    top5Consultants: top5Consultants,
    ...(paginateGerentes ? { consultantRankContributors, totalGerentes: totalGerentesCount, hasMoreGerentes } : {}),
    metaFunnel: !paginateGerentes || goffset === 0 ? metaFunnel : null,
    metaCampaignsData: !paginateGerentes || goffset === 0 ? metaCampaignsData : [],
  };
}

/**
 * Retorna os mesmos dados do dashboard (métricas, gerentes, consultores) usando apenas o ID da banca.
 * Se existir um dono com banca_url igual à URL da banca, usa a mesma lógica do dono (enroller = dono).
 * Caso contrário, usa usuários da banca em user_bancas (gerentes/consultores atribuídos).
 */
export async function getDashboardDataByBancaId({
  bancaId,
  dateFrom,
  dateTo,
  metaActiveOnly = true,
  skipMeta = false,
  skipExternalMetrics = false,
  gerentesOffset: rawGerentesOffset,
  gerentesLimit: rawGerentesLimit,
  signal,
}: DashboardByBancaParams) {
  throwIfAborted(signal);
  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, url, name')
    .eq('id', bancaId)
    .single();

  if (!banca?.url) {
    throw new Error('Banca não encontrada ou sem URL.');
  }

  const bancaUrl = banca.url;
  const bancaName = banca.name || banca.url || 'Banca';
  const normBancaUrl = normalizeBancaUrl(bancaUrl);

  // Se existir dono com esta banca (banca_url = url da banca), retorna os mesmos dados que o dono veria
  const { data: donos } = await supabaseServiceRole
    .from('profiles')
    .select('id, banca_url')
    .eq('status', 'dono_banca');
  const donoComBanca = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url ?? '') === normBancaUrl);
  if (donoComBanca?.id) {
    const data = await getDonoBancaDashboardData({
      userId: donoComBanca.id,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      metaActiveOnly,
      skipMeta,
      skipExternalMetrics,
      gerentesOffset: rawGerentesOffset,
      gerentesLimit: rawGerentesLimit,
      signal,
    });
    return { ...data, bancaId: data.bancaId ?? bancaId };
  }

  // Sem dono: usa gerentes/consultores atribuídos à banca via user_bancas (banca_ids JSONB)
  const { data: userBancas } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .filter('banca_ids', 'cs', JSON.stringify([bancaId]));

  const userIdsInBanca = (userBancas || []).map((r: { user_id: string }) => r.user_id);
  if (userIdsInBanca.length === 0) {
    let metaFunnel = null;
    let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
    if (!skipMeta) {
      try {
        [metaFunnel, metaCampaignsData] = await Promise.all([
          getMetaInsightsAggregated(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
          getMetaCampaignsWithInsights(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
        ]);
      } catch (_) {}
    }
    return {
      bancaId,
      bancaInfo: { name: bancaName, url: bancaUrl },
      chartData: {},
      externalMetrics: null,
      externalMetricsError: null,
      gerentes: [],
      top5Consultants: [],
      metaFunnel,
      metaCampaignsData,
    };
  }

  const { data: profilesInBanca } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status, enroller')
    .in('id', userIdsInBanca);

  const gerentesProfiles = (profilesInBanca || []).filter((p: { status: string }) => p.status === 'gerente');
  const consultoresInBanca = (profilesInBanca || []).filter((p: { status: string }) => p.status === 'consultor');

  const cleanBancaUrl = normalizeBancaUrl(bancaUrl);

  // Para bancas sem dono: incluir gerentes que têm consultores na banca (mesmo se gerente não estiver na banca)
  // e consultores sem gerente (sob "Consultores diretos")
  const consultoresByEnroller = new Map<string, typeof consultoresInBanca>();
  const consultoresSemGerente: typeof consultoresInBanca = [];
  const gerenteIdsToProcess = new Set<string>(gerentesProfiles.map((g: { id: string }) => g.id));
  const profileStatusById = new Map(
    (profilesInBanca || []).map((p: { id: string; status: string }) => [p.id, p.status])
  );

  const missingEnrollerIds = [
    ...new Set(
      consultoresInBanca
        .map((c: { enroller?: string | null }) => c.enroller)
        .filter((id): id is string => Boolean(id) && !profileStatusById.has(id!))
    ),
  ];
  if (missingEnrollerIds.length > 0) {
    const { data: enrollerProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, status')
      .in('id', missingEnrollerIds);
    for (const p of enrollerProfiles || []) {
      profileStatusById.set(p.id, p.status);
    }
  }

  for (const c of consultoresInBanca) {
    if (c.enroller) {
      if (profileStatusById.get(c.enroller) === 'gerente') {
        gerenteIdsToProcess.add(c.enroller);
        if (!consultoresByEnroller.has(c.enroller)) consultoresByEnroller.set(c.enroller, []);
        consultoresByEnroller.get(c.enroller)!.push(c);
      } else {
        consultoresSemGerente.push(c);
      }
    } else {
      consultoresSemGerente.push(c);
    }
  }

  // Gerentes na banca: incluir consultores subordinados diretos que também estão na banca
  for (const g of gerentesProfiles) {
    const subsInBanca = consultoresInBanca.filter(
      (p: { enroller?: string | null; status?: string }) => p.enroller === g.id && p.status === 'consultor'
    );
    const existing = consultoresByEnroller.get(g.id) || [];
    const merged = [...existing];
    for (const s of subsInBanca) {
      if (!merged.some((m: { id: string }) => m.id === s.id)) merged.push(s);
    }
    consultoresByEnroller.set(g.id, merged);
  }

  // Adiciona linha "Consultores diretos" para consultores sem gerente na banca
  if (consultoresSemGerente.length > 0) {
    gerenteIdsToProcess.add('__consultores_diretos__');
    consultoresByEnroller.set('__consultores_diretos__', consultoresSemGerente);
  }

  const gerentesToShow: Array<{ gerente: any; consultants: any[] }> = [];
  const missingGerenteIds = [...gerenteIdsToProcess].filter(
    (id) => id !== '__consultores_diretos__' && !gerentesProfiles.some((g: { id: string }) => g.id === id)
  );
  const gerenteProfileById = new Map(gerentesProfiles.map((g: { id: string }) => [g.id, g]));
  if (missingGerenteIds.length > 0) {
    const { data: extraGerentes } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller')
      .in('id', missingGerenteIds);
    for (const g of extraGerentes || []) {
      gerenteProfileById.set(g.id, g);
    }
  }

  for (const gerenteId of gerenteIdsToProcess) {
    const consultants = consultoresByEnroller.get(gerenteId) || [];
    if (gerenteId === '__consultores_diretos__') {
      gerentesToShow.push({
        gerente: { id: '__consultores_diretos__', email: '', full_name: 'Consultores diretos (sem gerente)', status: 'consultor' },
        consultants,
      });
    } else {
      const gerenteProfile = gerenteProfileById.get(gerenteId);
      if (gerenteProfile) {
        gerentesToShow.push({ gerente: gerenteProfile, consultants });
      }
    }
  }

  const paginateGerentes =
    rawGerentesLimit !== undefined && rawGerentesLimit !== null && Number.isFinite(Number(rawGerentesLimit));
  const goffset = Math.max(0, rawGerentesOffset ?? 0);
  const glimit = paginateGerentes ? Math.min(Math.max(Number(rawGerentesLimit), 1), 1000) : Number.POSITIVE_INFINITY;
  const totalGerentesCount = gerentesToShow.length;
  const gerentesPageTuples = paginateGerentes ? gerentesToShow.slice(goffset, goffset + glimit) : gerentesToShow;
  const hasMoreGerentes = paginateGerentes ? goffset + gerentesPageTuples.length < totalGerentesCount : false;

  const allConsultantsData: Array<{ id: string; email: string; name: string; total_deposited: number; total_leads: number; net_profit: number }> = [];

  let indicateds: IndicatedLead[] = [];
  let externalMetrics: ExternalMetricsShape | null = null;
  let metricsByConsultantEmailBanca = new Map<string, ConsultantAggregatedMetrics>();
  const loadHeaderMetrics = !paginateGerentes || goffset === 0;

  try {
    if (!paginateGerentes) {
      indicateds = await fetchIndicatedsByPeriod(cleanBancaUrl, dateFrom, dateTo, signal);
      externalMetrics = computeExternalMetricsFromLeads(indicateds);
      metricsByConsultantEmailBanca = aggregateIndicatedsByConsultant(indicateds);
      crmServiceVerboseLog(
        '[DonoBanca Service] getDashboardDataByBancaId - get-indicateds-by-consultant (banca/período):',
        indicateds.length,
        'leads → agregado por consultor:',
        metricsByConsultantEmailBanca.size
      );
    } else {
      let uniqueEmails: string[] = [];
      if (goffset === 0 && !skipExternalMetrics) {
        externalMetrics = await fetchDashboardMetrics(cleanBancaUrl, dateFrom, dateTo, signal);
      }
      const emails: string[] = [];
      for (const { consultants: cons } of gerentesPageTuples) {
        for (const c of cons ?? []) {
          if ((c as { email?: string }).email?.trim()) emails.push(String((c as { email: string }).email).trim());
        }
      }
      uniqueEmails = [...new Set(emails)];
      if (uniqueEmails.length > 0) {
        indicateds = await fetchIndicatedsByConsultants(cleanBancaUrl, dateFrom, dateTo, uniqueEmails, signal).catch((err: any) => {
          if (err?.name === 'AbortError') throw err;
          console.warn('[DonoBanca Service] getDashboardDataByBancaId (página) indicados:', err?.message);
          return [] as IndicatedLead[];
        });
        metricsByConsultantEmailBanca = aggregateIndicatedsByConsultant(indicateds);
      }
      if (!externalMetrics && goffset === 0 && indicateds.length > 0) {
        externalMetrics = computeExternalMetricsFromLeads(indicateds);
      }
      crmServiceVerboseLog('[DonoBanca Service] getDashboardDataByBancaId (paginado) consultants=', uniqueEmails.length, 'leads=', indicateds.length);
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[DonoBanca Service] getDashboardDataByBancaId - Erro ao buscar indicados:', err?.message);
  }

  const gerentesComMetricas = await Promise.all(
    gerentesPageTuples.map(async ({ gerente, consultants: gerenteConsultants }) => {
      const consultorsCount = gerenteConsultants?.length || 0;
      let gerenteMetrics = { total_leads: 0, total_deposited: 0, total_bets: 0, total_prizes: 0, active_leads: 0, net_profit: 0, conversion_rate: 0, total_depositos_count: 0 };

      if ((gerenteConsultants?.length ?? 0) > 0) {
        const consultantsFiltered = (gerenteConsultants ?? []).filter((c: any) => c.email);
        for (const consultor of consultantsFiltered) {
          const metrics = metricsByConsultantEmailBanca.get(consultor.email) ?? EMPTY_CONSULTANT_METRICS;
          gerenteMetrics.total_leads += metrics.total_leads;
          gerenteMetrics.total_deposited += metrics.total_deposited;
          gerenteMetrics.total_bets += metrics.total_bets;
          gerenteMetrics.total_prizes += metrics.total_prizes;
          gerenteMetrics.active_leads += metrics.active_leads;
          gerenteMetrics.net_profit += metrics.net_profit;
          gerenteMetrics.total_depositos_count += metrics.total_depositos_count;
          allConsultantsData.push({
            id: consultor.id,
            email: consultor.email,
            name: consultor.full_name || consultor.email,
            total_deposited: metrics.total_deposited,
            total_leads: metrics.total_leads,
            net_profit: metrics.net_profit,
          });
        }
        gerenteMetrics.conversion_rate = gerenteMetrics.total_leads > 0 ? (gerenteMetrics.active_leads / gerenteMetrics.total_leads) * 100 : 0;
      }

      return {
        ...gerente,
        metrics: {
          campaigns: 0,
          contacts: gerenteMetrics.total_leads,
          processed: gerenteMetrics.total_leads,
          failed: 0,
          consultorsCount,
          successRate: gerenteMetrics.conversion_rate.toFixed(2),
          externalKpis: {
            total_leads: gerenteMetrics.total_leads,
            total_deposited: gerenteMetrics.total_deposited,
            total_bets: gerenteMetrics.total_bets,
            total_prizes: gerenteMetrics.total_prizes,
            active_leads: gerenteMetrics.active_leads,
            net_profit: gerenteMetrics.net_profit,
            conversion_rate: gerenteMetrics.conversion_rate,
            total_depositos_count: gerenteMetrics.total_depositos_count,
          },
        },
      };
    })
  );

  if (!paginateGerentes) {
    const sumTotalDepositosCount = gerentesComMetricas.reduce(
      (acc, g) => acc + (g.metrics.externalKpis?.total_depositos_count ?? 0),
      0
    );
    const agregadoDepositosCountBanca = externalMetrics?.total_depositos_count ?? 0;
    crmServiceVerboseLog('[DonoBanca Service] getDashboardDataByBancaId - total_depositos_count (funil):', {
      agregado_api: agregadoDepositosCountBanca,
      soma_consultores: sumTotalDepositosCount,
    });
    if (externalMetrics && (externalMetrics.total_depositos_count ?? 0) === 0 && sumTotalDepositosCount > 0) {
      externalMetrics = { ...externalMetrics, total_depositos_count: sumTotalDepositosCount };
    }
  }

  const consultantRankContributors = allConsultantsData.map((c) => ({
    email: c.email,
    name: c.name,
    value: c.total_deposited,
  }));

  const top5Consultants = paginateGerentes
    ? []
    : allConsultantsData
        .filter((c) => c.total_deposited > 0)
        .sort((a, b) => b.total_deposited - a.total_deposited)
        .slice(0, 5)
        .map((c) => ({ name: c.name, value: c.total_deposited }));

  let metaFunnel = null;
  let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
  if (!skipMeta && (!paginateGerentes || goffset === 0)) {
    try {
      [metaFunnel, metaCampaignsData] = await Promise.all([
        getMetaInsightsAggregated(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
        getMetaCampaignsWithInsights(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
      ]);
    } catch (_) {}
  }

  return {
    bancaId,
    bancaInfo: { name: bancaName, url: bancaUrl },
    chartData: {},
    externalMetrics,
    externalMetricsError:
      loadHeaderMetrics && !externalMetrics && bancaUrl ? 'Erro ao buscar métricas da API externa' : null,
    gerentes: gerentesComMetricas,
    top5Consultants,
    ...(paginateGerentes ? { consultantRankContributors, totalGerentes: totalGerentesCount, hasMoreGerentes } : {}),
    metaFunnel: !paginateGerentes || goffset === 0 ? metaFunnel : null,
    metaCampaignsData: !paginateGerentes || goffset === 0 ? metaCampaignsData : [],
  };
}

