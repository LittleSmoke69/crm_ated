import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/crm/dashboard - Agrega métricas de todas ou uma banca específica
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = req.nextUrl;
    const bancaUrl = searchParams.get('banca_url');
    // Aceita tanto date_from/date_to quanto from/to para compatibilidade
    const dateFrom = searchParams.get('date_from') || searchParams.get('from');
    const dateTo = searchParams.get('date_to') || searchParams.get('to');
    
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('CRM_API_KEY não configurada.');
    }

    // Se uma banca específica foi solicitada
    if (bancaUrl && bancaUrl !== 'all') {
      const data = await fetchBancaDataRaw(bancaUrl, apiKey, dateFrom, dateTo);
      return successResponse(data);
    }

    // Se nenhuma banca específica, busca de todas as bancas cadastradas
    const { data: bancas, error: bancasError } = await supabaseServiceRole
      .from('crm_bancas')
      .select('url');

    if (bancasError) {
      return errorResponse(`Erro ao buscar bancas: ${bancasError.message}`);
    }

    if (!bancas || bancas.length === 0) {
      return successResponse({
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
          avg_ltv: 0
        },
        chartData: null
      });
    }

    // Busca dados de todas as bancas em paralelo
    const allData = await Promise.all(
      bancas.map(b => fetchBancaDataRaw(b.url, apiKey, dateFrom, dateTo))
    );

    // Agrega os resultados
    const aggregated = aggregateData(allData);
    return successResponse(aggregated);

  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

async function fetchBancaDataRaw(url: string, apiKey: string, dateFrom?: string | null, dateTo?: string | null) {
  // Normaliza a URL: remove protocolo e /api/crm se presente (garante apenas domínio)
  let cleanUrl = url.trim();
  
  // Remove protocolo se presente
  cleanUrl = cleanUrl.replace(/^https?:\/\//i, '');
  
  // Remove /api/crm se presente
  cleanUrl = cleanUrl.replace(/\/api\/crm\/?/i, '');
  
  // Remove barras finais
  cleanUrl = cleanUrl.replace(/\/+$/, '').trim();
  
  // Adiciona protocolo https://
  cleanUrl = `https://${cleanUrl}`;
  
  try {
    // Constrói URLs usando URLSearchParams para garantir encoding correto
    const metricsBaseUrl = `${cleanUrl}/api/crm/dashboard-metrics`;
    const chartsBaseUrl = `${cleanUrl}/api/crm/dashboard-chart-data`;
    
    const metricsUrlObj = new URL(metricsBaseUrl);
    const chartsUrlObj = new URL(chartsBaseUrl);
    
    // Adiciona parâmetros de data conforme curl especificado: date_from e date_to
    if (dateFrom && dateFrom.trim()) {
      metricsUrlObj.searchParams.append('date_from', dateFrom.trim());
      chartsUrlObj.searchParams.append('date_from', dateFrom.trim());
    }
    if (dateTo && dateTo.trim()) {
      metricsUrlObj.searchParams.append('date_to', dateTo.trim());
      chartsUrlObj.searchParams.append('date_to', dateTo.trim());
    }
    
    const metricsUrl = metricsUrlObj.toString();
    const chartsUrl = chartsUrlObj.toString();

    const [metricsRes, chartsRes] = await Promise.all([
      fetch(metricsUrl, { 
        headers: { 
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        } 
      }),
      fetch(chartsUrl, { 
        headers: { 
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        } 
      })
    ]);

    // Processa resposta da API de métricas
    let metricsData: any = {};
    if (metricsRes.ok) {
      const responseData = await metricsRes.json();
      // Aceita diferentes formatos de resposta
      if (responseData.success && responseData.metrics) {
        metricsData = responseData.metrics;
      } else if (responseData.metrics) {
        metricsData = responseData.metrics;
      } else if (responseData.total_leads !== undefined || responseData.total_deposited !== undefined) {
        metricsData = responseData;
      }
    }

    // Processa resposta da API de gráficos
    let chartsData: any = {};
    if (chartsRes.ok) {
      const responseData = await chartsRes.json();
      if (responseData.success && responseData.chartData) {
        chartsData = responseData.chartData;
      } else if (responseData.chartData) {
        chartsData = responseData.chartData;
      }
    }

    return {
      metrics: metricsData || {},
      chartData: chartsData || {}
    };
  } catch (err) {
    console.error(`Erro ao buscar dados da banca ${url}:`, err);
    return { metrics: {}, chartData: {} };
  }
}

function aggregateData(allData: any[]) {
  const aggregated = {
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
      avg_ltv: 0 // Mantido para compatibilidade
    },
    chartData: {
      status_distribution: {} as Record<string, number>,
      top_consultants: [] as any[],
      consultant_profitability: [] as any[],
      temporal_evolution: { dates: [] as string[], deposits: [] as number[], bets: [] as number[], profits: [] as number[] },
      conversion_funnel: { stages: [] as string[], values: [] as number[] },
      activity_by_weekday: { weekdays: [] as string[], values: [] as number[] }
    }
  };

  allData.forEach(data => {
    // Agrega Métricas
    const m = data.metrics;
    aggregated.metrics.total_leads += (m.total_leads || 0);
    aggregated.metrics.total_deposited += (m.total_deposited || 0);
    aggregated.metrics.total_bets += (m.total_bets || 0);
    aggregated.metrics.total_prizes += (m.total_prizes || 0);
    aggregated.metrics.awarded_clients_count += (m.awarded_clients_count || 0);
    aggregated.metrics.active_leads += (m.active_leads || 0);
    aggregated.metrics.net_profit += (m.net_profit || 0);
    
    // Agrega Distribuição de Status
    const dist = data.chartData?.status_distribution || {};
    Object.entries(dist).forEach(([status, count]) => {
      aggregated.chartData.status_distribution[status] = (aggregated.chartData.status_distribution[status] || 0) + (count as number);
    });

    // Agrega Evolução Temporal
    if (data.chartData?.temporal_evolution) {
      const te = data.chartData.temporal_evolution;
      te.dates?.forEach((date: string, idx: number) => {
        let aggIdx = aggregated.chartData.temporal_evolution.dates.indexOf(date);
        if (aggIdx === -1) {
          aggregated.chartData.temporal_evolution.dates.push(date);
          aggregated.chartData.temporal_evolution.deposits.push(te.deposits?.[idx] || 0);
          aggregated.chartData.temporal_evolution.bets.push(te.bets?.[idx] || 0);
          aggregated.chartData.temporal_evolution.profits.push(te.profits?.[idx] || 0);
        } else {
          aggregated.chartData.temporal_evolution.deposits[aggIdx] += (te.deposits?.[idx] || 0);
          aggregated.chartData.temporal_evolution.bets[aggIdx] += (te.bets?.[idx] || 0);
          aggregated.chartData.temporal_evolution.profits[aggIdx] += (te.profits?.[idx] || 0);
        }
      });
    }

    // Agrega Funil de Conversão
    if (data.chartData?.conversion_funnel) {
      const cf = data.chartData.conversion_funnel;
      cf.stages?.forEach((stage: string, idx: number) => {
        let aggIdx = aggregated.chartData.conversion_funnel.stages.indexOf(stage);
        if (aggIdx === -1) {
          aggregated.chartData.conversion_funnel.stages.push(stage);
          aggregated.chartData.conversion_funnel.values.push(cf.values?.[idx] || 0);
        } else {
          aggregated.chartData.conversion_funnel.values[aggIdx] += (cf.values?.[idx] || 0);
        }
      });
    }

    // Agrega Atividade por Dia da Semana
    if (data.chartData?.activity_by_weekday) {
      const aw = data.chartData.activity_by_weekday;
      aw.weekdays?.forEach((day: string, idx: number) => {
        let aggIdx = aggregated.chartData.activity_by_weekday.weekdays.indexOf(day);
        if (aggIdx === -1) {
          aggregated.chartData.activity_by_weekday.weekdays.push(day);
          aggregated.chartData.activity_by_weekday.values.push(aw.values?.[idx] || 0);
        } else {
          aggregated.chartData.activity_by_weekday.values[aggIdx] += (aw.values?.[idx] || 0);
        }
      });
    }
  });

  // Recalcula Taxa de Conversão e LTV Médio do agregado
  if (aggregated.metrics.total_leads > 0) {
    aggregated.metrics.conversion_rate = (aggregated.metrics.active_leads / aggregated.metrics.total_leads) * 100;
    // Usa ltv_avg (nome correto da API) mas mantém avg_ltv para compatibilidade
    const ltvValue = aggregated.metrics.total_deposited / aggregated.metrics.total_leads;
    aggregated.metrics.ltv_avg = ltvValue;
    aggregated.metrics.avg_ltv = ltvValue;
  }

  return aggregated;
}

