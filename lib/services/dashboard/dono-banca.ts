import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinateIds } from '@/lib/middleware/permissions';
import { getMetaInsightsAggregated, getMetaCampaignsWithInsights } from '@/lib/services/meta-sync-service';

export interface DonoBancaDashboardParams {
  userId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  metaActiveOnly?: boolean;
  /** Quando true, não busca Meta Ads. Use quando Meta será carregado em chamada separada. */
  skipMeta?: boolean;
}

export interface DashboardByBancaParams {
  bancaId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  metaActiveOnly?: boolean;
  /** Quando true, não busca Meta Ads. Use quando Meta será carregado em chamada separada. */
  skipMeta?: boolean;
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

/** Lead retornado por get-indicateds-by-consultant (campos usados na agregação) */
export interface IndicatedLead {
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
 * Pagina automaticamente (per_page=2000) e retorna o array completo de leads.
 */
export async function fetchIndicatedsByPeriod(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<IndicatedLead[]> {
  const apiKey = process.env.CRM_API_KEY;
  const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
  const perPage = 2000;
  const maxPages = 100;
  const allData: IndicatedLead[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const params = new URLSearchParams();
    params.set('per_page', String(perPage));
    params.set('page', String(page));
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const url = `${baseUrl}?${params.toString()}`;
    const curlCmd = `curl -X GET "${url}" -H "Accept: application/json" -H "X-API-KEY: ${apiKey ?? '<CRM_API_KEY>'}"`;
    console.log(`[fetchIndicatedsByPeriod] GET get-indicateds-by-consultant | page=${page} | curl:\n${curlCmd}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) break;
    const result = await res.json();
    const data = result?.data;
    if (!Array.isArray(data) || data.length === 0) break;
    allData.push(...(data as IndicatedLead[]));
    const total = result?.pagination?.total ?? data.length;
    const lastPage = result?.pagination?.last_page ?? 1;
    if (page >= lastPage || data.length < perPage) hasMore = false;
    else page++;
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
    console.log('[GestorTrafego/IndicatedsOnly] Indicados no período:', indicateds.length);
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

async function fetchDashboardMetrics(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<ExternalMetricsShape | null> {
  try {
    const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
    if (dateFrom) externalApiUrl.searchParams.append('date_from', dateFrom);
    if (dateTo) externalApiUrl.searchParams.append('date_to', dateTo);
    const apiKey = process.env.CRM_API_KEY;
    const startTime = Date.now();
    const res = await fetch(externalApiUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
    });
    console.log('[DonoBanca Service] dashboard-metrics status:', res.status, `(${Date.now() - startTime}ms)`);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) return null;
    const externalData = await res.json();
    let metrics: any = null;
    if (externalData?.success && externalData.metrics) metrics = externalData.metrics;
    else if (externalData?.metrics) metrics = externalData.metrics;
    else if (externalData?.total_leads !== undefined || externalData?.total_deposited !== undefined) metrics = externalData;
    if (!metrics) return null;
    return {
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
  } catch (err: any) {
    console.warn('[DonoBanca Service] Erro ao buscar dashboard-metrics:', err?.message);
    return null;
  }
}

export async function getDonoBancaDashboardData({ userId, dateFrom, dateTo, metaActiveOnly = true, skipMeta = false }: DonoBancaDashboardParams) {
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

  // Paraleliza: bancas lookup + dashboard-metrics + get-indicateds-by-consultant + gerentes
  const [bancasDono, externalMetricsRaw, indicatedsRaw, gerentesResult] = await Promise.all([
    supabaseServiceRole.from('crm_bancas').select('id, url'),
    cleanBancaUrl ? fetchDashboardMetrics(cleanBancaUrl, dateFrom, dateTo) : Promise.resolve(null),
    cleanBancaUrl
      ? fetchIndicatedsByPeriod(cleanBancaUrl, dateFrom, dateTo).catch((err: any) => {
          console.warn('[DonoBanca Service] Erro ao buscar indicados:', err?.message);
          return [] as IndicatedLead[];
        })
      : Promise.resolve([] as IndicatedLead[]),
    supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('enroller', userId)
      .eq('status', 'gerente'),
  ]);

  const bancaMatchDono = (bancasDono.data || []).find(
    (b: { url: string }) => normalizeBancaUrl(b.url) === normalizeBancaUrl(donoProfile?.banca_url ?? '')
  );
  const bancaIdDono = bancaMatchDono?.id;
  let externalMetrics: ExternalMetricsShape | null = externalMetricsRaw;
  const gerentes = gerentesResult.data;

  if (externalMetrics) {
    console.log('[DonoBanca Service] dashboard-metrics recebidas. total_leads:', externalMetrics.total_leads);
  }
  console.log('[DonoBanca Service] Gerentes encontrados:', gerentes?.length || 0);

  // Agrega indicados por consultor para preencher métricas dos gerentes
  const metricsByConsultantEmail = aggregateIndicatedsByConsultant(indicatedsRaw);
  console.log('[DonoBanca Service] Indicados agregados por consultor:', metricsByConsultantEmail.size);

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

  const gerentesComMetricas = await Promise.all(
    (gerentes || []).map(async (gerente: any) => {
      console.log(`[DonoBanca Service] 📊 TABELA GERENTES - Buscando métricas do gerente: ${gerente.email}`);
      
      // Busca consultores deste gerente (com nome completo)
      const gerenteSubordinateIds = await getSubordinateIds(gerente.id);
      const { data: gerenteConsultants } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .in('id', gerenteSubordinateIds)
        .eq('status', 'consultor');

      const consultorsCount = gerenteConsultants?.length || 0;
      console.log(`[DonoBanca Service] 👥 Gerente ${gerente.email} tem ${consultorsCount} consultores`);

      // Inicializa métricas agregadas do gerente (soma de todos os consultores)
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

      // Usa o mapa de métricas por consultor (uma única requisição get-indicateds-by-consultant já feita)
      if (gerenteConsultants && gerenteConsultants.length > 0) {
        const consultantsFiltered = gerenteConsultants.filter((c: any) => c.email);
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
        console.log(`[DonoBanca Service] ✅ SOMA FINAL do gerente ${gerente.email} (${consultorsCount} consultores):`, {
          total_leads: gerenteMetrics.total_leads,
          total_deposited: `R$ ${(gerenteMetrics.total_deposited / 1000).toFixed(1)}k`,
          net_profit: `R$ ${(gerenteMetrics.net_profit / 1000).toFixed(1)}k`,
          conversion_rate: `${gerenteMetrics.conversion_rate.toFixed(2)}%`,
          total_depositos_count: gerenteMetrics.total_depositos_count,
        });
      }

      let consultoresEmOutrasBancas: Array<{ id: string; email: string; full_name: string | null }> = [];
      if (bancaIdDono && (gerenteConsultants || []).length > 0) {
        const consultantIds = (gerenteConsultants || []).map((c: { id: string }) => c.id);
        const { data: ubRows } = await supabaseServiceRole
          .from('user_bancas')
          .select('user_id, banca_ids')
          .in('user_id', consultantIds);
        const userIdsInThisBanca = new Set(
          (ubRows || []).filter((r: { user_id: string; banca_ids: string[] }) => Array.isArray(r.banca_ids) && r.banca_ids.includes(bancaIdDono!)).map((r: { user_id: string }) => r.user_id)
        );
        consultoresEmOutrasBancas = (gerenteConsultants || []).filter((c: { id: string }) => !userIdsInThisBanca.has(c.id)).map((c: { id: string; email: string; full_name: string | null }) => ({ id: c.id, email: c.email, full_name: c.full_name }));
      }

      return {
        ...gerente,
        consultoresEmOutrasBancas,
        metrics: {
          campaigns: 0,
          contacts: gerenteMetrics.total_leads,
          processed: gerenteMetrics.total_leads,
          failed: 0,
          consultorsCount: consultorsCount,
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

  // Total de depósitos (contagem) agregado de todos os consultores — usado no funil quando a API agregada não retorna
  const sumTotalDepositosCount = gerentesComMetricas.reduce(
    (acc, g) => acc + (g.metrics.externalKpis?.total_depositos_count ?? 0),
    0
  );
  const agregadoDepositosCount = externalMetrics?.total_depositos_count ?? 0;
  const usadoNoFunil = agregadoDepositosCount > 0 ? agregadoDepositosCount : sumTotalDepositosCount;
  console.log('[DonoBanca Service] 📦 total_depositos_count (funil):', {
    agregado_api: agregadoDepositosCount,
    soma_consultores: sumTotalDepositosCount,
    usado_no_funil: usadoNoFunil,
  });
  if (externalMetrics && (externalMetrics.total_depositos_count ?? 0) === 0 && sumTotalDepositosCount > 0) {
    externalMetrics = { ...externalMetrics, total_depositos_count: sumTotalDepositosCount };
  }

  // ============================================
  // TOP 5 CONSULTORES: Ordena por vendas (total_deposited) e pega os top 5
  // ============================================
  console.log('[DonoBanca Service] 📊 Total de consultores coletados:', allConsultantsData.length);
  
  const top5Consultants = allConsultantsData
    .filter(c => c.total_deposited > 0) // Filtra apenas consultores com vendas
    .sort((a, b) => b.total_deposited - a.total_deposited) // Ordena por vendas (maior para menor)
    .slice(0, 5) // Pega apenas os top 5
    .map(c => ({
      name: c.name,
      value: c.total_deposited,
    }));

  console.log('[DonoBanca Service] 🏆 Top 5 Consultores por Vendas:', top5Consultants);

  // Calcula total de consultores para log
  const totalConsultores = gerentesComMetricas.reduce((sum, g) => sum + (g.metrics.consultorsCount || 0), 0);
  
  // Log final resumindo todas as requisições
  console.log('[DonoBanca Service] 📋 Resumo das requisições:');
  console.log('[DonoBanca Service]   ✅ RESUMO GERAL: Métricas agregadas da banca (sem consultant)');
  console.log('[DonoBanca Service]   ✅ TABELA GERENTES: Soma de métricas de todos os consultores (com consultant)');
  console.log('[DonoBanca Service]   ✅ Gerentes processados:', gerentesComMetricas.length);
  console.log('[DonoBanca Service]   ✅ Total de consultores:', totalConsultores);
  console.log('[DonoBanca Service]   ⚡ OTIMIZAÇÃO: Uma única requisição get-indicateds-by-consultant (from/to) → agregado por consultor');
  console.log('[DonoBanca Service]   📊 API: /api/crm/get-indicateds-by-consultant');
  console.log('[DonoBanca Service]   📅 Filtros aplicados: date_from=' + dateFrom + ', date_to=' + dateTo);
  console.log('[DonoBanca Service]   💰 total_depositos_count (para estágio Depósitos do funil):', externalMetrics?.total_depositos_count ?? 'n/a');
  console.log('[DonoBanca Service] 🎉 Processamento concluído!');

  // Meta Ads: busca insights agregados para o funil 3D e dados por campanha (pulado quando skipMeta=true)
  let metaFunnel = null;
  let metaCampaignsData: Awaited<ReturnType<typeof getMetaCampaignsWithInsights>> = [];
  let bancaIdForMeta: string | undefined;
  try {
    const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
    const bancaMatch = (bancas || []).find(
      (b: { url: string }) => normalizeBancaUrl(b.url) === normalizeBancaUrl(donoProfile?.banca_url ?? '')
    );
    bancaIdForMeta = bancaMatch?.id;
    if (bancaIdForMeta && !skipMeta) {
      [metaFunnel, metaCampaignsData] = await Promise.all([
        getMetaInsightsAggregated(bancaIdForMeta, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
        getMetaCampaignsWithInsights(bancaIdForMeta, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly),
      ]);
    }
  } catch (metaErr: any) {
    console.warn('[DonoBanca Service] Meta insights não disponíveis:', metaErr?.message);
  }

  return {
    bancaId: bancaIdForMeta ?? undefined,
    bancaInfo: {
      name: donoProfile?.banca_name || null,
      url: donoProfile?.banca_url || null,
    },
    chartData,
    externalMetrics: externalMetrics,
    externalMetricsError: !externalMetrics && donoProfile?.banca_url ? 'Erro ao buscar métricas da API externa' : null,
    gerentes: gerentesComMetricas,
    top5Consultants: top5Consultants,
    metaFunnel,
    metaCampaignsData,
  };
}

/**
 * Retorna os mesmos dados do dashboard (métricas, gerentes, consultores) usando apenas o ID da banca.
 * Se existir um dono com banca_url igual à URL da banca, usa a mesma lógica do dono (enroller = dono).
 * Caso contrário, usa usuários da banca em user_bancas (gerentes/consultores atribuídos).
 */
export async function getDashboardDataByBancaId({ bancaId, dateFrom, dateTo, metaActiveOnly = true, skipMeta = false }: DashboardByBancaParams) {
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

  let externalMetrics = null;
  try {
    const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
    const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
    if (dateFrom) externalApiUrl.searchParams.append('date_from', dateFrom);
    if (dateTo) externalApiUrl.searchParams.append('date_to', dateTo);
    const apiKey = process.env.CRM_API_KEY;
    const res = await fetch(externalApiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
    });
    if (res.ok) {
      const data = await res.json();
      const metrics = data?.metrics ?? data;
      if (metrics && (metrics.total_leads !== undefined || metrics.total_deposited !== undefined)) {
        externalMetrics = {
          total_leads: Number(metrics.total_leads) || 0,
          total_deposited: Number(metrics.total_deposited) || 0,
          total_bets: Number(metrics.total_bets) || 0,
          total_prizes: Number(metrics.total_prizes) || 0,
          total_withdrawals: (Number(metrics.total_withdrawals) ?? Number(metrics.total_prizes)) || 0,
          awarded_clients_count: Number(metrics.awarded_clients_count) || 0,
          total_depositos_count: Number(metrics.total_depositos_count) || 0,
          active_leads: Number(metrics.active_leads) || 0,
          conversion_rate: Number(metrics.conversion_rate) || 0,
          ltv_avg: Number(metrics.ltv_avg) || 0,
          net_profit: Number(metrics.net_profit) ?? (Number(metrics.total_deposited) || 0) - (Number(metrics.total_prizes) || 0),
        };
        console.log('[DonoBanca Service] getDashboardDataByBancaId - Métricas agregadas (sem consultant):', {
          total_depositos_count: externalMetrics.total_depositos_count,
          total_depositos_count_veio_na_api: metrics.total_depositos_count !== undefined && metrics.total_depositos_count !== null,
        });
      }
    }
  } catch (e: any) {
    console.warn('[DonoBanca Service] getDashboardDataByBancaId - Erro métricas externas:', e?.message);
  }

  const allConsultantsData: Array<{ id: string; email: string; name: string; total_deposited: number; total_leads: number; net_profit: number }> = [];
  const cleanBancaUrl = normalizeBancaUrl(bancaUrl);

  // Uma única requisição get-indicateds-by-consultant (from/to) → agregado por consultant_email
  let metricsByConsultantEmailBanca = new Map<string, ConsultantAggregatedMetrics>();
  try {
    const indicateds = await fetchIndicatedsByPeriod(cleanBancaUrl, dateFrom, dateTo);
    metricsByConsultantEmailBanca = aggregateIndicatedsByConsultant(indicateds);
    console.log('[DonoBanca Service] getDashboardDataByBancaId - Indicados agregados por consultor:', metricsByConsultantEmailBanca.size);
  } catch (err: any) {
    console.warn('[DonoBanca Service] getDashboardDataByBancaId - Erro ao buscar indicados por período:', err?.message);
  }

  // Para bancas sem dono: incluir gerentes que têm consultores na banca (mesmo se gerente não estiver na banca)
  // e consultores sem gerente (sob "Consultores diretos")
  const consultoresByEnroller = new Map<string, typeof consultoresInBanca>();
  const consultoresSemGerente: typeof consultoresInBanca = [];
  const gerenteIdsToProcess = new Set<string>(gerentesProfiles.map((g: { id: string }) => g.id));

  for (const c of consultoresInBanca) {
    if (c.enroller) {
      const enrollerProfile = await supabaseServiceRole.from('profiles').select('id, status').eq('id', c.enroller).single();
      if (enrollerProfile?.data?.status === 'gerente') {
        gerenteIdsToProcess.add(enrollerProfile.data.id);
        if (!consultoresByEnroller.has(c.enroller)) consultoresByEnroller.set(c.enroller, []);
        consultoresByEnroller.get(c.enroller)!.push(c);
      } else {
        consultoresSemGerente.push(c);
      }
    } else {
      consultoresSemGerente.push(c);
    }
  }

  // Gerentes na banca: incluir consultores subordinados que também estão na banca
  for (const g of gerentesProfiles) {
    const subIds = await getSubordinateIds(g.id);
    const subsInBanca = (profilesInBanca || []).filter((p: { id: string; status?: string }) => subIds.includes(p.id) && p.status === 'consultor');
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
        gerenteProfile = profileData ? { ...profileData } : undefined;
      }
      if (gerenteProfile) {
        gerentesToShow.push({ gerente: gerenteProfile, consultants });
      }
    }
  }

  const gerentesComMetricas = await Promise.all(
    gerentesToShow.map(async ({ gerente, consultants: gerenteConsultants }) => {
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

  // Total de depósitos (contagem) agregado de todos os consultores — para o funil quando a API agregada não retorna
  const sumTotalDepositosCount = gerentesComMetricas.reduce(
    (acc, g) => acc + (g.metrics.externalKpis?.total_depositos_count ?? 0),
    0
  );
  const agregadoDepositosCountBanca = externalMetrics?.total_depositos_count ?? 0;
  const usadoNoFunilBanca = agregadoDepositosCountBanca > 0 ? agregadoDepositosCountBanca : sumTotalDepositosCount;
  console.log('[DonoBanca Service] getDashboardDataByBancaId - total_depositos_count (funil):', {
    agregado_api: agregadoDepositosCountBanca,
    soma_consultores: sumTotalDepositosCount,
    usado_no_funil: usadoNoFunilBanca,
  });
  if (externalMetrics && (externalMetrics.total_depositos_count ?? 0) === 0 && sumTotalDepositosCount > 0) {
    externalMetrics = { ...externalMetrics, total_depositos_count: sumTotalDepositosCount };
  }

  const top5Consultants = allConsultantsData
    .filter((c) => c.total_deposited > 0)
    .sort((a, b) => b.total_deposited - a.total_deposited)
    .slice(0, 5)
    .map((c) => ({ name: c.name, value: c.total_deposited }));

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
    externalMetrics,
    externalMetricsError: !externalMetrics && bancaUrl ? 'Erro ao buscar métricas da API externa' : null,
    gerentes: gerentesComMetricas,
    top5Consultants,
    metaFunnel,
    metaCampaignsData,
  };
}

