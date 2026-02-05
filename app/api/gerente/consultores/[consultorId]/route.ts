import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager, getHierarchyPath } from '@/lib/utils/hierarchy';

/**
 * GET /api/gerente/consultores/[consultorId]
 * Retorna métricas detalhadas de um consultor específico para o Gerente
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  let consultorId: string | undefined;
  try {
    const { userId: managerId } = await requireStatus(req, ['gerente']);
    const resolvedParams = await params;
    consultorId = resolvedParams.consultorId;

    // Busca parâmetros da query string
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaUrlFilter = searchParams.get('banca_url');

    // 1. Verifica se o consultor existe e pertence ao gerente
    const consultores = await getConsultorsByManager(managerId);
    const consultor = consultores.find(c => c.id === consultorId);

    if (!consultor) {
      return errorResponse('Consultor não encontrado ou você não tem permissão para visualizá-lo', 404);
    }

    // 2. Banca URL é opcional - se não fornecida, retorna apenas dados básicos do consultor
    const bancaUrl = bancaUrlFilter || null;

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

    // 6. Busca leads individuais usando get-indicateds-by-consultant
    const apiKey = process.env.CRM_API_KEY;
    
    let chartData = null;
    let externalKpis = null;
    let externalKpisError: string | null = null;
    
    if (bancaUrl && consultor.email) {
      try {
        // Normaliza a URL da banca
        let cleanBancaUrl = bancaUrl.trim();
        if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
          cleanBancaUrl = `https://${cleanBancaUrl}`;
        }
        cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');
        
        // Usa a API get-indicateds-by-consultant para buscar leads individuais
        const indicatedsApiUrl = new URL(`${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`);
        indicatedsApiUrl.searchParams.append('consultant', consultor.email);
        indicatedsApiUrl.searchParams.append('per_page', '9999999');
        
        // Adiciona parâmetros de data de cadastro (from e to)
        if (dateFrom) {
          indicatedsApiUrl.searchParams.append('from', dateFrom);
        }
        if (dateTo) {
          indicatedsApiUrl.searchParams.append('to', dateTo);
        }

        console.log('[Gerente Consultor Detail API] 🔗 URL:', indicatedsApiUrl.toString());
        console.log('[Gerente Consultor Detail API] 📅 Filtros:', { dateFrom, dateTo, consultant: consultor.email });

        const indicatedsResponse = await fetch(indicatedsApiUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(apiKey && { 'X-API-KEY': apiKey }),
          },
        });

        if (indicatedsResponse.ok) {
          const indicatedsData = await indicatedsResponse.json();
          const indicateds = indicatedsData.data || indicatedsData || [];
          
          console.log('[Gerente Consultor Detail API] ✅ Leads recebidos:', indicateds.length);
          
          // Processa dados para gráficos e KPIs
          const engagementStats = {
            no_play: 0,
            deposit_1x: 0,
            deposit_2x: 0,
            deposit_3x_plus: 0
          };
          
          const statusDistribution: Record<string, number> = {};
          const starsDistribution: Record<string, number> = {};
          const topBettors: Array<{ name: string; value: number }> = [];
          const topWinners: Array<{ name: string; value: number }> = [];
          const topDepositors: Array<{ name: string; value: number }> = [];
          
          let totalLeads = 0;
          let totalDeposited = 0;
          let totalBets = 0;
          let totalPrizes = 0;
          let activeLeads = 0;

          indicateds.forEach((lead: any) => {
            totalLeads++;
            
            // Tenta múltiplos campos possíveis para contar depósitos
            const totalDepositosCount = parseInt(
              lead.total_depositos_count || 
              lead.deposits_count || 
              lead.deposit_count || 
              (lead.total_depositado > 0 ? '1' : '0') || 
              '0'
            ) || 0;
            
            const totalDepositado = parseFloat(lead.total_depositado || lead.total_deposited || '0') || 0;
            const totalApostado = parseFloat(lead.total_apostado || lead.total_bets || '0') || 0;
            const totalGanho = parseFloat(lead.total_ganho || lead.total_prizes || '0') || 0;
            const isActive = lead.status === 'ativo' || lead.temperature === 'active' || lead.status === 'active';
            
            // Engajamento (jogou 1x, 2x, 3x+)
            // Se não tiver contagem de depósitos, usa o valor depositado como indicador
            let depositCount = totalDepositosCount;
            if (depositCount === 0 && totalDepositado > 0) {
              // Se depositou mas não tem contagem, assume pelo menos 1 depósito
              depositCount = 1;
            }
            
            if (depositCount === 0) {
              engagementStats.no_play++;
            } else if (depositCount === 1) {
              engagementStats.deposit_1x++;
            } else if (depositCount === 2) {
              engagementStats.deposit_2x++;
            } else if (depositCount >= 3) {
              engagementStats.deposit_3x_plus++;
            }

            // Distribuição por Status
            const status = lead.status || 'novo';
            statusDistribution[status] = (statusDistribution[status] || 0) + 1;

            // Distribuição por Estrelas
            const stars = parseInt(String(lead.stars || lead.user_level || 0)) || 0;
            const starsKey = stars > 0 ? `${stars} ⭐` : 'Sem estrelas';
            starsDistribution[starsKey] = (starsDistribution[starsKey] || 0) + 1;

            // Top Apostadores
            if (totalApostado > 0) {
              topBettors.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalApostado,
              });
            }

            // Top Ganhadores
            if (totalGanho > 0) {
              topWinners.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalGanho,
              });
            }

            // Top Depositantes
            if (totalDepositado > 0) {
              topDepositors.push({
                name: lead.name || lead.full_name || 'Sem nome',
                value: totalDepositado,
              });
            }

            // Agrega KPIs
            totalDeposited += totalDepositado;
            totalBets += totalApostado;
            totalPrizes += totalGanho;
            if (isActive) {
              activeLeads++;
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

          // Calcula KPIs agregados
          const conversionRate = totalLeads > 0 ? (activeLeads / totalLeads) * 100 : 0;
          const netProfit = totalDeposited - totalPrizes; // Simplificado - pode precisar de saques

          externalKpis = {
            total_leads: totalLeads,
            total_deposited: totalDeposited,
            total_bets: totalBets,
            total_prizes: totalPrizes,
            awarded_clients_count: top10Winners.length,
            active_leads: activeLeads,
            conversion_rate: conversionRate,
            ltv_avg: totalLeads > 0 ? totalDeposited / totalLeads : 0,
            net_profit: netProfit,
          };

          chartData = {
            engagement_distribution: {
              "Cadastrados": engagementStats.no_play,
              "Jogaram 1x": engagementStats.deposit_1x,
              "Jogaram 2x": engagementStats.deposit_2x,
              "Jogaram 3x+": engagementStats.deposit_3x_plus
            },
            status_distribution: statusDistribution,
            stars_distribution: starsDistribution,
            stars_distribution_array: starsArray,
            top_bettors: top10Bettors,
            top_winners: top10Winners,
            top_depositors: top10Depositors,
            total_indicateds: indicateds.length,
          };

          console.log('[Gerente Consultor Detail API] ✅ Dados processados:', {
            totalLeads,
            engagement: engagementStats,
            stars: starsArray.length,
            topBettors: top10Bettors.length,
            topWinners: top10Winners.length,
            topDepositors: top10Depositors.length,
          });
        } else {
          const errorText = await indicatedsResponse.text();
          let errorMessage = '';
          
          // Verifica se é o caso de "No indicateds found"
          if (indicatedsResponse.status === 404) {
            try {
              const errorJson = JSON.parse(errorText);
              if (errorJson.message && errorJson.message.includes('No indicateds found')) {
                errorMessage = 'NO_DATA'; // Flag especial para o frontend tratar
                console.log('[Gerente Consultor Detail API] ℹ️ Nenhum indicado encontrado para o filtro selecionado');
              } else {
                errorMessage = `Erro ${indicatedsResponse.status}: ${errorText.substring(0, 50)}`;
              }
            } catch {
              // Se não conseguir parsear, verifica se a mensagem contém "No indicateds found"
              if (errorText.includes('No indicateds found')) {
                errorMessage = 'NO_DATA';
                console.log('[Gerente Consultor Detail API] ℹ️ Nenhum indicado encontrado para o filtro selecionado');
              } else {
                errorMessage = `Erro ${indicatedsResponse.status}: ${errorText.substring(0, 50)}`;
              }
            }
          } else {
            errorMessage = `Erro ${indicatedsResponse.status}: ${errorText.substring(0, 50)}`;
          }
          
          externalKpisError = errorMessage;
          if (errorMessage !== 'NO_DATA') {
            console.error('[Gerente Consultor Detail API] ❌ Erro ao buscar leads:', externalKpisError);
          }
        }
      } catch (error: any) {
        console.error('[Gerente Consultor Detail API] Erro ao buscar leads:', error.message);
        externalKpisError = error.message || 'Erro ao buscar leads';
      }
    }

    return successResponse({
      consultor: {
        id: consultor.id,
        email: consultor.email,
        full_name: consultor.full_name,
        created_at: consultor.created_at,
        enroller: consultor.enroller,
      },
      externalKpis,
      externalKpisError,
      chartData,
    });
  } catch (err: any) {
    console.error('[Gerente Consultor Detail API] Erro:', err.message);
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/gerente/consultores/[consultorId]
 * Permite ao Gerente deletar um consultor diretamente abaixo dele
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId: managerId } = await requireStatus(req, ['gerente']);
    const resolvedParams = await params;
    const consultorId = resolvedParams.consultorId;

    if (!consultorId) {
      return errorResponse('ID do consultor é obrigatório', 400);
    }

    // 1. Verifica se o consultor existe e pertence ao gerente
    const consultores = await getConsultorsByManager(managerId);
    const consultor = consultores.find(c => c.id === consultorId);

    if (!consultor) {
      return errorResponse('Consultor não encontrado ou você não tem permissão para deletá-lo', 404);
    }

    // 2. Verifica se o consultor tem subordinados (consultores não deveriam ter, mas verificamos por segurança)
    const { data: subordinates } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('enroller', consultorId);

    if (subordinates && subordinates.length > 0) {
      return errorResponse(
        'Não é possível remover consultor com subordinados. Reatribua os subordinados primeiro.',
        400
      );
    }

    // 3. Remove configurações do usuário
    await supabaseServiceRole
      .from('user_settings')
      .delete()
      .eq('user_id', consultorId);

    // 4. Remove o consultor
    const { error: deleteError } = await supabaseServiceRole
      .from('profiles')
      .delete()
      .eq('id', consultorId);

    if (deleteError) {
      return errorResponse(`Erro ao remover consultor: ${deleteError.message}`, 400);
    }

    return successResponse({ id: consultorId }, 'Consultor removido com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

