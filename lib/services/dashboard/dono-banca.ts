import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinateIds } from '@/lib/middleware/permissions';

export interface DonoBancaDashboardParams {
  userId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
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
  
  // Adiciona protocolo https://
  if (normalized) {
    normalized = `https://${normalized}`;
  }
  
  return normalized;
}

export async function getDonoBancaDashboardData({ userId, dateFrom, dateTo }: DonoBancaDashboardParams) {
  // Busca informações do dono de banca (incluindo banca_url)
  const { data: donoProfile } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, banca_url, banca_name, status')
    .eq('id', userId)
    .single();

  if (!donoProfile || donoProfile.status !== 'dono_banca') {
    throw new Error('Acesso negado. Perfil não encontrado ou não é dono de banca.');
  }

  // ============================================
  // RESUMO GERAL: Busca métricas agregadas de TODA a banca
  // Usa: GET /api/crm/dashboard-metrics?date_from={{date_from}}&date_to={{date_to}}
  // ============================================
  let externalMetrics = null;
  if (donoProfile?.banca_url) {
    try {
      const cleanBancaUrl = normalizeBancaUrl(donoProfile.banca_url);
      const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
      
      // Adiciona parâmetros de data conforme especificado
      if (dateFrom) externalApiUrl.searchParams.append('date_from', dateFrom);
      if (dateTo) externalApiUrl.searchParams.append('date_to', dateTo);
      
      const apiKey = process.env.CRM_API_KEY;
      const requestUrl = externalApiUrl.toString();
      
      console.log('[DonoBanca Service] 📊 RESUMO GERAL - Buscando métricas agregadas da banca');
      console.log('[DonoBanca Service] 🔗 URL:', requestUrl);
      console.log('[DonoBanca Service] 📅 Filtros:', { dateFrom, dateTo });
      console.log('[DonoBanca Service] 🔑 API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'não configurada');
      
      const startTime = Date.now();
      const externalResponse = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(apiKey && { 'X-API-KEY': apiKey }),
        },
      });
      const responseTime = Date.now() - startTime;

      console.log('[DonoBanca Service] ✅ Resposta recebida');
      console.log('[DonoBanca Service] 📈 Status:', externalResponse.status, externalResponse.statusText);
      console.log('[DonoBanca Service] ⏱️  Tempo de resposta:', `${responseTime}ms`);

      if (externalResponse.ok) {
        let externalData;
        try {
          const contentType = externalResponse.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            externalData = await externalResponse.json();
          } else {
            const textResponse = await externalResponse.text();
            console.error('[DonoBanca Service] ❌ Resposta não é JSON:', textResponse.substring(0, 500));
            throw new Error('Resposta da API não é JSON válido');
          }
        } catch (parseError: any) {
          console.error('[DonoBanca Service] ❌ Erro ao parsear resposta JSON:', parseError.message);
          throw parseError;
        }

        // Processa TODOS os dados da resposta da API
        if (externalData) {
          // Aceita diferentes formatos de resposta
          let metrics = null;
          if (externalData.success && externalData.metrics) {
            metrics = externalData.metrics;
          } else if (externalData.metrics) {
            metrics = externalData.metrics;
          } else if (externalData.total_leads !== undefined || externalData.total_deposited !== undefined) {
            // Se a resposta já é o objeto de métricas diretamente
            metrics = externalData;
          }

          if (metrics) {
            // Normaliza e valida TODOS os valores numéricos da resposta
            // Captura todos os campos fornecidos pela API
            externalMetrics = {
              total_leads: Number(metrics.total_leads) || 0,
              total_deposited: Number(metrics.total_deposited) || 0,
              total_bets: Number(metrics.total_bets) || 0,
              total_prizes: Number(metrics.total_prizes) || 0,
              total_withdrawals: Number(metrics.total_withdrawals) || Number(metrics.total_prizes) || 0,
              awarded_clients_count: Number(metrics.awarded_clients_count) || 0,
              active_leads: Number(metrics.active_leads) || 0,
              conversion_rate: Number(metrics.conversion_rate) || 0,
              ltv_avg: Number(metrics.ltv_avg) || 0,
              net_profit: Number(metrics.net_profit) || (Number(metrics.total_deposited) || 0) - (Number(metrics.total_prizes) || 0),
            };
            console.log('[DonoBanca Service] ✅ Métricas do RESUMO GERAL recebidas:', {
              total_leads: externalMetrics.total_leads,
              total_deposited: externalMetrics.total_deposited,
              total_bets: externalMetrics.total_bets,
              total_prizes: externalMetrics.total_prizes,
              awarded_clients_count: externalMetrics.awarded_clients_count,
              active_leads: externalMetrics.active_leads,
              conversion_rate: externalMetrics.conversion_rate,
              ltv_avg: externalMetrics.ltv_avg,
              net_profit: externalMetrics.net_profit
            });
          } else {
            console.warn('[DonoBanca Service] ⚠️  Resposta sem métricas válidas. Estrutura recebida:', JSON.stringify(externalData).substring(0, 500));
          }
        }
      } else {
        const errorText = await externalResponse.text();
        console.error('[DonoBanca Service] ❌ Erro na resposta do RESUMO GERAL:', externalResponse.status, errorText.substring(0, 200));
      }
    } catch (error: any) {
      console.error('[DonoBanca Service] ❌ Erro ao buscar métricas do RESUMO GERAL:', error.message);
      console.error('[DonoBanca Service] 📚 Stack:', error.stack);
    }
  }

  // Dados de gráficos não são mais buscados da API externa
  const chartData = {};

  // OTIMIZAÇÃO: Removida busca individual de leads de consultores
  // Agora usamos apenas a API agregada /api/crm/dashboard-metrics que já retorna dados otimizados
  // Isso elimina centenas de requisições individuais e melhora drasticamente a performance

  // Mantém externalMetrics com os dados originais da API externa para o resumo geral
  // NOTA: O resumo geral usa dados da API externa do CRM filtrados por banca e período de tempo
  
  if (externalMetrics) {
    console.log('[DonoBanca Service] 📊 Resumo Geral usará dados da API externa:', {
      'Total de Leads (API)': externalMetrics.total_leads || 0,
      'Total Depositado (API)': externalMetrics.total_deposited || 0,
      'Total Apostado (API)': externalMetrics.total_bets || 0,
      'Total Prêmios (API)': externalMetrics.total_prizes || 0,
      'Lucro Líquido (API)': externalMetrics.net_profit || 0,
      'Taxa de Conversão (API)': `${externalMetrics.conversion_rate || 0}%`
    });
  }

  // Log para debug: confirma fonte de dados
  console.log('[DonoBanca Service] 📊 Fonte de dados:', {
    'Resumo Geral': 'API Externa (/api/crm/dashboard-metrics)',
    'Métricas dos Gerentes': 'API Externa (/api/crm/dashboard-metrics?consultant=...) agregado por gerente'
  });

  // Busca apenas a lista de gerentes (estrutura organizacional) do banco
  const { data: gerentes } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name')
    .eq('enroller', userId)
    .eq('status', 'gerente');

  console.log('[DonoBanca Service] 👔 Total de gerentes encontrados:', gerentes?.length || 0);

  // ============================================
  // TABELA DE GERENTES: Busca métricas de cada consultor e soma por gerente
  // Usa: GET /api/crm/dashboard-metrics?consultant={{consultant_email}}&date_from={{date_from}}&date_to={{date_to}}
  // Para cada consultor de cada gerente, busca métricas e soma tudo
  // Também coleta dados individuais de todos os consultores para o gráfico Top 5
  // ============================================
  
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
      };

      // Busca métricas de cada consultor via API e agrega (SOMA)
      if (donoProfile?.banca_url && gerenteConsultants && gerenteConsultants.length > 0) {
        const cleanBancaUrl = normalizeBancaUrl(donoProfile.banca_url);
        const apiKey = process.env.CRM_API_KEY;

        // Busca métricas de TODOS os consultores em paralelo
        const consultorMetricsPromises = gerenteConsultants
          .filter(c => c.email) // Filtra apenas consultores com email
          .map(async (consultor) => {
            try {
              // Monta URL exatamente como no curl especificado
              const metricsUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
              metricsUrl.searchParams.append('consultant', consultor.email);
              if (dateFrom) metricsUrl.searchParams.append('date_from', dateFrom);
              if (dateTo) metricsUrl.searchParams.append('date_to', dateTo);

              const startTime = Date.now();
              const response = await fetch(metricsUrl.toString(), {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                  ...(apiKey && { 'X-API-KEY': apiKey }),
                },
              });
              const responseTime = Date.now() - startTime;

              if (response.ok) {
                const data = await response.json();
                
                // Processa TODOS os dados da resposta
                let metrics = null;
                if (data.success && data.metrics) {
                  metrics = data.metrics;
                } else if (data.metrics) {
                  metrics = data.metrics;
                } else if (data.total_leads !== undefined || data.total_deposited !== undefined) {
                  metrics = data;
                }

                if (metrics) {
                  const totalDeposited = Number(metrics.total_deposited) || 0;
                  const totalLeads = Number(metrics.total_leads) || 0;
                  const netProfit = Number(metrics.net_profit) || (totalDeposited - (Number(metrics.total_prizes) || 0));
                  
                  console.log(`[DonoBanca Service] ✅ Consultor ${consultor.email}: ${totalLeads} leads, R$ ${(totalDeposited / 1000)}k depositado (${responseTime}ms)`);
                  
                  // Adiciona aos dados coletados para o gráfico Top 5
                  allConsultantsData.push({
                    id: consultor.id,
                    email: consultor.email,
                    name: consultor.full_name || consultor.email,
                    total_deposited: totalDeposited,
                    total_leads: totalLeads,
                    net_profit: netProfit,
                  });
                  
                  // Retorna TODOS os dados da resposta normalizados
                  return {
                    total_leads: totalLeads,
                    total_deposited: totalDeposited,
                    total_bets: Number(metrics.total_bets) || 0,
                    total_prizes: Number(metrics.total_prizes) || 0,
                    active_leads: Number(metrics.active_leads) || 0,
                    net_profit: netProfit,
                    conversion_rate: Number(metrics.conversion_rate) || 0,
                  };
                }
              } else {
                const errorText = await response.text();
                console.warn(`[DonoBanca Service] ⚠️  Erro ao buscar métricas do consultor ${consultor.email}: ${response.status} - ${errorText.substring(0, 100)}`);
              }
            } catch (error: any) {
              console.warn(`[DonoBanca Service] ⚠️  Erro ao buscar métricas do consultor ${consultor.email}:`, error.message);
            }
            
            // Retorna métricas zeradas em caso de erro
            return {
              total_leads: 0,
              total_deposited: 0,
              total_bets: 0,
              total_prizes: 0,
              active_leads: 0,
              net_profit: 0,
              conversion_rate: 0,
            };
          });

        // Aguarda todas as requisições e SOMA os resultados
        const consultorMetricsResults = await Promise.all(consultorMetricsPromises);
        
        // SOMA todas as métricas dos consultores para obter o total do gerente
        consultorMetricsResults.forEach((metrics) => {
          gerenteMetrics.total_leads += metrics.total_leads;
          gerenteMetrics.total_deposited += metrics.total_deposited;
          gerenteMetrics.total_bets += metrics.total_bets;
          gerenteMetrics.total_prizes += metrics.total_prizes;
          gerenteMetrics.active_leads += metrics.active_leads;
          gerenteMetrics.net_profit += metrics.net_profit;
        });

        // Calcula taxa de conversão agregada (baseada no somatório)
        gerenteMetrics.conversion_rate = gerenteMetrics.total_leads > 0
          ? (gerenteMetrics.active_leads / gerenteMetrics.total_leads) * 100
          : 0;

        console.log(`[DonoBanca Service] ✅ SOMA FINAL do gerente ${gerente.email} (${consultorsCount} consultores):`, {
          total_leads: gerenteMetrics.total_leads,
          total_deposited: `R$ ${(gerenteMetrics.total_deposited / 1000).toFixed(1)}k`,
          net_profit: `R$ ${(gerenteMetrics.net_profit / 1000).toFixed(1)}k`,
          conversion_rate: `${gerenteMetrics.conversion_rate.toFixed(2)}%`
        });
      }

      return {
        ...gerente,
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
          },
        },
      };
    })
  );

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
  console.log('[DonoBanca Service]   ⚡ OTIMIZAÇÃO: Requisições em paralelo para métricas dos consultores');
  console.log('[DonoBanca Service]   📊 API: /api/crm/dashboard-metrics');
  console.log('[DonoBanca Service]   📅 Filtros aplicados: date_from=' + dateFrom + ', date_to=' + dateTo);
  console.log('[DonoBanca Service] 🎉 Processamento concluído!');

  return {
    bancaInfo: {
      name: donoProfile?.banca_name || null,
      url: donoProfile?.banca_url || null,
    },
    chartData,
    // Todas as métricas agora vêm da API externa
    externalMetrics: externalMetrics,
    externalMetricsError: !externalMetrics && donoProfile?.banca_url ? 'Erro ao buscar métricas da API externa' : null,
    gerentes: gerentesComMetricas,
    // Top 5 consultores por vendas (independente do gerente)
    top5Consultants: top5Consultants,
  };
}

