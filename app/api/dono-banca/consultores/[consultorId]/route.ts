import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';

/**
 * GET /api/dono-banca/consultores/[consultorId]
 * Retorna métricas detalhadas de um consultor específico para o Dono de Banca
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  let consultorId: string | undefined;
  try {
    const { userId: ownerId } = await requireStatus(req, ['dono_banca']);
    const resolvedParams = await params;
    consultorId = resolvedParams.consultorId;

    // Busca parâmetros de data da query string
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // 1. Verifica se o consultor pertence à banca
    const isOwner = await isInHierarchy(ownerId, consultorId!);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este consultor não pertence à sua banca.', 403);
    }

    // 2. Busca dados do Consultor
    const { data: consultor } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at, enroller')
      .eq('id', consultorId)
      .single();

    if (!consultor) {
      return errorResponse('Consultor não encontrado.', 404);
    }

    // 3. Busca campanhas do consultor
    const { data: campaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .eq('user_id', consultorId!)
      .order('created_at', { ascending: false });

    // 4. Busca contatos/leads do consultor
    const { data: leads } = await supabaseServiceRole
      .from('searches')
      .select('*')
      .eq('user_id', consultorId!)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: false });

    // 5. Calcula métricas
    const totalProcessed = campaigns?.reduce((s, c) => s + (c.processed_contacts || 0), 0) || 0;
    const totalFailed = campaigns?.reduce((s, c) => s + (c.failed_contacts || 0), 0) || 0;

    // 6. Busca KPIs da API externa usando o email do consultor
    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    const bancaUrl = donoProfile?.banca_url;
    const apiKey = process.env.CRM_API_KEY;
    
    let externalKpis = null;
    let externalKpisError: string | null = null;
    
    if (bancaUrl && consultor.email) {
      try {
        const cleanBancaUrl = bancaUrl.replace(/\/+$/, '');
        const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
        externalApiUrl.searchParams.append('consultant', consultor.email);
        
        // Adiciona parâmetros de data se fornecidos
        if (dateFrom) {
          externalApiUrl.searchParams.append('date_from', dateFrom);
        }
        if (dateTo) {
          externalApiUrl.searchParams.append('date_to', dateTo);
        }

        const externalResponse = await fetch(externalApiUrl.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey && { 'X-API-KEY': apiKey }),
          },
        });

        if (externalResponse.ok) {
          const externalData = await externalResponse.json();
          if (externalData.success && externalData.metrics) {
            externalKpis = {
              total_leads: externalData.metrics.total_leads || 0,
              total_deposited: externalData.metrics.total_deposited || 0,
              total_bets: externalData.metrics.total_bets || 0,
              total_prizes: externalData.metrics.total_prizes || 0,
              active_leads: externalData.metrics.active_leads || 0,
              conversion_rate: externalData.metrics.conversion_rate || 0,
              net_profit: externalData.metrics.net_profit || 0,
            };
          } else {
            externalKpisError = 'Dados não disponíveis';
          }
        } else {
          const errorText = await externalResponse.text();
          externalKpisError = `Erro ${externalResponse.status}: ${errorText.substring(0, 50)}`;
        }
      } catch (error: any) {
        externalKpisError = error.message || 'Erro ao buscar KPIs';
      }
    }

    // Busca dados de indicados do CRM usando a nova API
    let chartData = null;
    if (bancaUrl && consultor.email) {
      try {
        // Normaliza a URL da banca
        let cleanBancaUrl = bancaUrl.trim();
        cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();
        cleanBancaUrl = `https://${cleanBancaUrl}`;

        // Usa a nova API: get-indicateds-by-consultant
        const indicatedsApiUrl = new URL(`${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`);
        indicatedsApiUrl.searchParams.append('consultant', consultor.email);
        indicatedsApiUrl.searchParams.append('per_page', '9999999');
        
        // Adiciona parâmetros de data de cadastro conforme o período selecionado
        // from = data inicial de cadastro (YYYY-MM-DD)
        // to = data final de cadastro (YYYY-MM-DD)
        // Esses parâmetros filtram os indicados pela data de cadastro
        if (dateFrom) {
          indicatedsApiUrl.searchParams.append('from', dateFrom);
        }
        if (dateTo) {
          indicatedsApiUrl.searchParams.append('to', dateTo);
        }

        console.log('[Consultores API] Buscando indicados da URL:', indicatedsApiUrl.toString());
        console.log('[Consultores API] Parâmetros - consultant:', consultor.email);
        if (dateFrom || dateTo) {
          console.log('[Consultores API] Filtro de período aplicado - from:', dateFrom || 'não informado', 'to:', dateTo || 'não informado');
        } else {
          console.log('[Consultores API] Sem filtro de período - buscando todos os indicados');
        }

        const indicatedsResponse = await fetch(indicatedsApiUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(apiKey && { 'X-API-KEY': apiKey }),
          },
        });

        console.log('[Consultores API] Resposta dos indicados - Status:', indicatedsResponse.status);
        console.log('[Consultores API] Resposta dos indicados - OK:', indicatedsResponse.ok);

        if (indicatedsResponse.ok) {
          const indicatedsData = await indicatedsResponse.json();
          console.log('[Consultores API] Dados de indicados recebidos');
          
          // Processa os dados para criar gráficos
          const indicateds = indicatedsData.data || indicatedsData || [];
          
          // Processa dados para gráficos
          const statusDistribution: Record<string, number> = {};
          const starsDistribution: Record<string, number> = {};
          const topBettors: Array<{ name: string; value: number }> = [];
          const topWinners: Array<{ name: string; value: number }> = [];
          const topDepositors: Array<{ name: string; value: number }> = [];

          indicateds.forEach((lead: any) => {
            // Distribuição por Status
            const status = lead.status || 'novo';
            statusDistribution[status] = (statusDistribution[status] || 0) + 1;

            // Distribuição por Estrelas
            const stars = parseInt(String(lead.stars || lead.user_level || 0)) || 0;
            const starsKey = stars > 0 ? `${stars} ⭐` : 'Sem estrelas';
            starsDistribution[starsKey] = (starsDistribution[starsKey] || 0) + 1;

            // Top Apostadores
            const totalApostado = parseFloat(lead.total_apostado || lead.total_bets || 0) || 0;
            if (totalApostado > 0) {
              topBettors.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalApostado,
              });
            }

            // Top Ganhadores
            const totalGanho = parseFloat(lead.total_ganho || lead.total_prizes || 0) || 0;
            if (totalGanho > 0) {
              topWinners.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalGanho,
              });
            }

            // Top Depositantes
            const totalDepositado = parseFloat(lead.total_depositado || lead.total_deposited || 0) || 0;
            if (totalDepositado > 0) {
              topDepositors.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalDepositado,
              });
            }
          });

          // Ordena distribuição de estrelas
          const starsArray = Object.entries(starsDistribution)
            .map(([key, value]) => {
              const starsNum = parseInt(key.replace(/[^0-9]/g, '')) || 0;
              return { name: key, value: value as number, starsNum };
            })
            .sort((a, b) => a.starsNum - b.starsNum)
            .map(item => ({ name: item.name, value: item.value }));

          // Ordena e pega top 10
          const top10Bettors = topBettors.sort((a, b) => b.value - a.value).slice(0, 10);
          const top10Winners = topWinners.sort((a, b) => b.value - a.value).slice(0, 10);
          const top10Depositors = topDepositors.sort((a, b) => b.value - a.value).slice(0, 10);

          chartData = {
            status_distribution: statusDistribution,
            stars_distribution: starsDistribution,
            stars_distribution_array: starsArray,
            top_bettors: top10Bettors,
            top_winners: top10Winners,
            top_depositors: top10Depositors,
            total_indicateds: indicateds.length,
          };

          console.log('[Consultores API] Gráficos processados com sucesso:', {
            total_indicateds: indicateds.length,
            hasStatusDistribution: Object.keys(statusDistribution).length > 0,
            hasStarsDistribution: starsArray.length > 0,
            topBettors: top10Bettors.length,
            topWinners: top10Winners.length,
            topDepositors: top10Depositors.length,
          });
        } else {
          const errorText = await indicatedsResponse.text();
          console.error('[Consultores API] Erro na resposta dos indicados - Status:', indicatedsResponse.status);
          console.error('[Consultores API] Erro na resposta dos indicados - Body:', errorText.substring(0, 200));
        }
      } catch (error: any) {
        console.error('[Consultores API] Erro ao buscar dados de indicados:', error.message);
        console.error('[Consultores API] Stack:', error.stack);
        console.error('[Consultores API] Banca URL:', bancaUrl);
        console.error('[Consultores API] Consultor Email:', consultor.email);
        chartData = null;
      }
    } else {
      console.log('[Consultores API] Banca URL ou email do consultor não configurado:', {
        hasBancaUrl: !!bancaUrl,
        hasEmail: !!consultor.email,
      });
    }
    
    console.log('[Consultores API] chartData final:', chartData ? 'presente' : 'null');

    return successResponse({
      consultor,
      campaigns: campaigns || [],
      leadsCount: leads?.length || 0,
      metrics: {
        processed: totalProcessed,
        failed: totalFailed,
        successRate: totalProcessed > 0 ? ((totalProcessed - totalFailed) / totalProcessed * 100).toFixed(2) : '0.00'
      },
      externalKpis,
      externalKpisError,
      chartData,
    });
  } catch (err: any) {
    console.error('[Consultores API] Erro:', err.message);
    console.error('[Consultores API] Stack:', err.stack);
    console.error('[Consultores API] ConsultorId:', consultorId);
    return serverErrorResponse(err);
  }
}

