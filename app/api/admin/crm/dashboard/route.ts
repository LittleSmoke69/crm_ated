import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  fetchIndicatedsByPeriod,
  computeExternalMetricsFromLeads,
  aggregateIndicatedsByConsultant,
  type IndicatedLead,
} from '@/lib/services/dashboard/dono-banca';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function normalizeBancaUrl(url: string): string {
  let clean = url.trim();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/\/api\/crm\/?/i, '');
  clean = clean.replace(/\/+$/, '').trim();
  return clean ? `https://${clean}`.toLowerCase() : '';
}

/** Lead com banca de origem e campos opcionais do CRM (estrelas, afiliados). */
type LeadWithBanca = IndicatedLead & {
  banca_name?: string;
  aposta_estrelas?: number;
  total_afiliate?: number;
};

/** Métricas completas por consultor para Top 5 (vários critérios de ordenação). */
interface ConsultantMetrics {
  consultant_name: string;
  bancas: Set<string>;
  total_deposited: number;
  total_leads: number;
  total_apostado: number;
  total_apostado_bichao: number;
  /** Quantidade de clientes com mais de 1 estrela (classificação). */
  clientes_estrelas: number;
  total_afiliate: number;
}

const EMPTY_CONSULTANT_METRICS: ConsultantMetrics = {
  consultant_name: 'Consultor',
  bancas: new Set(),
  total_deposited: 0,
  total_leads: 0,
  total_apostado: 0,
  total_apostado_bichao: 0,
  clientes_estrelas: 0,
  total_afiliate: 0,
};

function aggregateByConsultantFull(leads: LeadWithBanca[]): Map<string, ConsultantMetrics> {
  const map = new Map<string, ConsultantMetrics>();
  for (const lead of leads) {
    const email = lead.consultant_email?.trim?.() || '';
    if (!email) continue;
    if (!map.has(email)) {
      map.set(email, {
        ...EMPTY_CONSULTANT_METRICS,
        consultant_name: lead.consultant_name?.trim?.() || 'Consultor',
        bancas: new Set(),
      });
    }
    const entry = map.get(email)!;
    entry.total_deposited += Number(lead.total_depositado) || 0;
    entry.total_leads += 1;
    const apostado = Number(lead.total_apostado) ?? (Number(lead.total_apostado_loteria) || 0) + (Number(lead.total_apostado_bichao) || 0);
    entry.total_apostado += apostado;
    entry.total_apostado_bichao += Number(lead.total_apostado_bichao) || 0;
    const estrelas = Number((lead as LeadWithBanca).aposta_estrelas) || 0;
    if (estrelas > 1) entry.clientes_estrelas += 1;
    entry.total_afiliate += Number((lead as LeadWithBanca).total_afiliate) || 0;
    if (lead.banca_name?.trim()) entry.bancas.add(lead.banca_name.trim());
  }
  return map;
}

/**
 * Constrói chartData no formato esperado pelo CRMSection a partir da lista de leads
 * retornada por get-indicateds-by-consultant (com banca_name quando agregando várias bancas).
 */
/** Distribuição por quantidade de depósitos: apenas cadastraram, 1x, 2x, 3x, 4x, 5x, 6-9x, 10x+ */
function buildDepositsCountDistribution(leads: LeadWithBanca[]): Record<string, number> {
  const labels: Record<string, number> = {
    'Apenas cadastraram': 0,
    'Depositaram 1x': 0,
    'Depositaram 2x': 0,
    'Depositaram 3x': 0,
    'Depositaram 4x': 0,
    'Depositaram 5x': 0,
    'Depositaram 6x a 9x': 0,
    'Depositaram 10x+': 0,
  };
  for (const lead of leads) {
    const n = parseInt(String(lead.total_depositos_count ?? 0), 10) || 0;
    if (n === 0) labels['Apenas cadastraram']++;
    else if (n === 1) labels['Depositaram 1x']++;
    else if (n === 2) labels['Depositaram 2x']++;
    else if (n === 3) labels['Depositaram 3x']++;
    else if (n === 4) labels['Depositaram 4x']++;
    else if (n === 5) labels['Depositaram 5x']++;
    else if (n >= 6 && n <= 9) labels['Depositaram 6x a 9x']++;
    else labels['Depositaram 10x+']++;
  }
  return labels;
}

/** Retorno de métricas por consultor para o frontend aplicar filtro Top 5 sem nova requisição. */
export interface ConsultantMetricsRow {
  name: string;
  email: string;
  bancas: string[];
  total_deposited: number;
  total_leads: number;
  total_apostado: number;
  total_apostado_bichao: number;
  /** Quantidade de clientes com mais de 1 estrela. */
  clientes_estrelas: number;
  total_afiliate: number;
}

function buildChartDataFromLeads(leads: LeadWithBanca[]) {
  const status_distribution = buildDepositsCountDistribution(leads);

  const byConsultant = aggregateByConsultantFull(leads);
  const byConsultantLegacy = aggregateIndicatedsByConsultant(leads);
  const consultants_metrics: ConsultantMetricsRow[] = Array.from(byConsultant.entries()).map(([email, m]) => ({
    name: m.consultant_name,
    email,
    bancas: Array.from(m.bancas),
    total_deposited: m.total_deposited,
    total_leads: m.total_leads,
    total_apostado: m.total_apostado,
    total_apostado_bichao: m.total_apostado_bichao,
    clientes_estrelas: m.clientes_estrelas,
    total_afiliate: m.total_afiliate,
  }));

  const consultant_profitability = Array.from(byConsultantLegacy.entries())
    .filter(([, m]) => m.net_profit !== 0)
    .sort((a, b) => b[1].net_profit - a[1].net_profit)
    .slice(0, 5)
    .map(([, m]) => ({ name: m.consultant_name || 'Consultor', value: m.net_profit }));

  const dateMap = new Map<string, { deposits: number; bets: number; profits: number }>();
  for (const lead of leads) {
    const raw = lead.created_at?.slice?.(0, 10);
    if (!raw) continue;
    const dep = Number(lead.total_depositado) || 0;
    const bet = Number(lead.total_apostado) ?? (Number(lead.total_apostado_loteria) || 0) + (Number(lead.total_apostado_bichao) || 0);
    const prize = Number(lead.total_ganho) || 0;
    if (!dateMap.has(raw)) dateMap.set(raw, { deposits: 0, bets: 0, profits: 0 });
    const cur = dateMap.get(raw)!;
    cur.deposits += dep;
    cur.bets += bet;
    cur.profits += dep - prize;
  }
  const sortedDates = Array.from(dateMap.keys()).sort();
  const temporal_evolution = {
    dates: sortedDates,
    deposits: sortedDates.map(d => dateMap.get(d)!.deposits),
    bets: sortedDates.map(d => dateMap.get(d)!.bets),
    profits: sortedDates.map(d => dateMap.get(d)!.profits),
  };

  const withDeposit = leads.filter(l => (Number(l.total_depositos_count) || 0) > 0 || (Number(l.total_depositado) || 0) > 0).length;
  const active = leads.filter(l => ['ativo', 'active', 'deposito'].includes(String(l.status || '').toLowerCase())).length;
  const conversion_funnel = {
    stages: ['Leads', 'Com depósito', 'Ativos'],
    values: [leads.length, withDeposit, active],
  };

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const lead of leads) {
    const iso = lead.created_at?.slice?.(0, 10);
    if (!iso) continue;
    const d = new Date(iso + 'T12:00:00Z');
    const day = d.getUTCDay();
    weekdayCounts[day]++;
  }
  const activity_by_weekday = {
    weekdays: WEEKDAY_LABELS,
    values: weekdayCounts,
  };

  return {
    status_distribution,
    consultants_metrics,
    consultant_profitability,
    temporal_evolution,
    conversion_funnel,
    activity_by_weekday,
  };
}

function emptyResponse() {
  return {
    metrics: {
      total_leads: 0,
      total_deposited: 0,
      total_bets: 0,
      total_prizes: 0,
      awarded_clients_count: 0,
      active_leads: 0,
      conversion_rate: 0,
      net_profit: 0,
      ltv_avg: 0,
      avg_ltv: 0,
    },
    chartData: {
      status_distribution: {},
      consultants_metrics: [],
      consultant_profitability: [],
      temporal_evolution: { dates: [], deposits: [], bets: [], profits: [] },
      conversion_funnel: { stages: [] as string[], values: [] as number[] },
      activity_by_weekday: { weekdays: WEEKDAY_LABELS, values: [0, 0, 0, 0, 0, 0, 0] },
    },
  };
}

/**
 * GET /api/admin/crm/dashboard
 * Utiliza exclusivamente o endpoint get-indicateds-by-consultant (from/to) para todas ou uma banca.
 * - Opção padrão "Todas as bancas": busca em cada banca de crm_bancas e soma todos os indicados.
 * - Parâmetros: date_from e date_to (ou from/to). Se omitidos, usa a data de hoje.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = req.nextUrl;
    const bancaUrl = searchParams.get('banca_url');
    const dateFrom = searchParams.get('date_from') || searchParams.get('from');
    const dateTo = searchParams.get('date_to') || searchParams.get('to');

    const today = new Date().toISOString().slice(0, 10);
    const from = (dateFrom?.trim() || today);
    const to = (dateTo?.trim() || today);

    if (!process.env.CRM_API_KEY) {
      return errorResponse('CRM_API_KEY não configurada.');
    }

    if (bancaUrl && bancaUrl !== 'all') {
      const cleanUrl = normalizeBancaUrl(bancaUrl);
      if (!cleanUrl) {
        return successResponse(emptyResponse());
      }
      const { data: bancasList } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url, name')
        .not('url', 'is', null);
      const bancaRow = (bancasList ?? []).find((b: { url: string }) => normalizeBancaUrl(b.url) === cleanUrl);
      const bancaName = bancaRow?.name ?? null;
      let leadsRaw: IndicatedLead[] = [];
      try {
        leadsRaw = await fetchIndicatedsByPeriod(cleanUrl, from, to);
      } catch (err) {
        console.error('Erro ao buscar indicados da banca:', err);
        return successResponse(emptyResponse());
      }
      const leads: LeadWithBanca[] = bancaName
        ? leadsRaw.map((l) => ({ ...l, banca_name: bancaName }))
        : leadsRaw.map((l) => ({ ...l }));
      const metrics = computeExternalMetricsFromLeads(leads);
      const chartData = buildChartDataFromLeads(leads);
      return successResponse({
        metrics: {
          total_leads: metrics.total_leads,
          total_deposited: metrics.total_deposited,
          total_bets: metrics.total_bets,
          total_prizes: metrics.total_prizes,
          awarded_clients_count: metrics.awarded_clients_count,
          active_leads: metrics.active_leads,
          conversion_rate: metrics.conversion_rate,
          net_profit: metrics.net_profit,
          ltv_avg: metrics.ltv_avg,
          avg_ltv: metrics.ltv_avg,
        },
        chartData,
      });
    }

    const { data: bancas, error: bancasError } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, url, name')
      .not('url', 'is', null);

    if (bancasError) {
      return errorResponse(`Erro ao buscar bancas: ${bancasError.message}`);
    }

    if (!bancas || bancas.length === 0) {
      return successResponse(emptyResponse());
    }

    const allLeads: LeadWithBanca[] = [];
    await Promise.all(
      bancas.map(async (b: { id: string; url: string; name: string | null }) => {
        const cleanUrl = normalizeBancaUrl(b.url);
        if (!cleanUrl) return;
        try {
          const leads = await fetchIndicatedsByPeriod(cleanUrl, from, to);
          const bancaName = b.name?.trim() || null;
          allLeads.push(...leads.map((l) => ({ ...l, banca_name: bancaName ?? undefined })));
        } catch (err) {
          console.error(`Erro ao buscar indicados (${b.url}):`, err);
        }
      })
    );

    const metrics = computeExternalMetricsFromLeads(allLeads);
    const chartData = buildChartDataFromLeads(allLeads);

    return successResponse({
      metrics: {
        total_leads: metrics.total_leads,
        total_deposited: metrics.total_deposited,
        total_bets: metrics.total_bets,
        total_prizes: metrics.total_prizes,
        awarded_clients_count: metrics.awarded_clients_count,
        active_leads: metrics.active_leads,
        conversion_rate: metrics.conversion_rate,
        net_profit: metrics.net_profit,
        ltv_avg: metrics.ltv_avg,
        avg_ltv: metrics.ltv_avg,
      },
      chartData,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
