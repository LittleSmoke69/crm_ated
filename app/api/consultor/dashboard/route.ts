import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getHierarchyPath } from '@/lib/utils/hierarchy';

/**
 * Busca o total de saques de um usuário usando a API de saques
 */
async function getUserWithdrawals(bancaUrl: string, oddsUserId: number, apiKey: string | undefined): Promise<number> {
  try {
    const withdrawsApiUrl = new URL(`${bancaUrl}/api/crm/get-user-withdraws`);
    withdrawsApiUrl.searchParams.append('user_id', oddsUserId.toString());
    withdrawsApiUrl.searchParams.append('per_page', '10000');

    const response = await fetch(withdrawsApiUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-KEY': apiKey }),
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        // Retorna o total de saques (soma de todos os saques aprovados)
        return data.total || 0;
      }
    }
    return 0;
  } catch (error) {
    console.error('[Consultor Dashboard API] Erro ao buscar saques do usuário:', error);
    return 0;
  }
}

/**
 * GET /api/consultor/dashboard - Dashboard de desempenho do Consultor
 * Calcula todos os gráficos diretamente dos dados dos leads
 * Busca saques de cada lead usando API separada
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['consultor', 'super_admin', 'admin']);

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaUrlFilter = searchParams.get('banca_url');
    const searchBy = searchParams.get('search_by') || 'created_at';
    const consultorIdFilter = searchParams.get('consultor_id')?.trim() || null;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    // super_admin/admin podem ver desempenho de outro consultor: consultor_id + banca_url obrigatórios
    let effectiveUserId = userId;
    if (isAdminOrSuperAdmin && consultorIdFilter) {
      const targetProfile = await getUserProfile(consultorIdFilter);
      if (targetProfile?.status === 'consultor') {
        effectiveUserId = consultorIdFilter;
      }
    }

    let bancaUrl = bancaUrlFilter;
    if (!bancaUrl) {
      const hierarchyPath = await getHierarchyPath(effectiveUserId);
      const donoBanca = hierarchyPath.find(p => p.status === 'dono_banca');
      if (donoBanca) {
        const { data: donoProfile } = await supabaseServiceRole
          .from('profiles')
          .select('banca_url')
          .eq('id', donoBanca.id)
          .single();
        bancaUrl = donoProfile?.banca_url;
      }
    }
    if (isAdminOrSuperAdmin && consultorIdFilter && !bancaUrl) {
      return errorResponse('Para visualizar desempenho de um consultor, informe banca_url e consultor_id.', 400);
    }

    const consultorProfile = await getUserProfile(effectiveUserId);
    
    let externalKpis = null;
    let externalKpisError: string | null = null;
    let chartData: any = null;
    
    const engagementStats = {
      no_play: 0,
      deposit_1x: 0,
      deposit_2x: 0,
      deposit_3x_plus: 0
    };

    if (bancaUrl) {
      // Busca leads individuais para calcular TODOS os gráficos e KPIs
      if (consultorProfile?.email) {
        try {
          let cleanBancaUrl = bancaUrl.trim();
          if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
            cleanBancaUrl = `https://${cleanBancaUrl}`;
          }
          cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');
          
          const apiKey = process.env.CRM_API_KEY;
          
          // Sempre busca a base COMPLETA do consultor (sem from/to) para evitar 404 da API externa.
          // O filtro por período (created_at ou last_deposit_at) é aplicado localmente depois.
          let allLeads: any[] = [];
          const perPage = 2000;
          let currentPage = 1;
          let hasMore = true;
          const maxPages = 1000; // Limite de segurança

          console.log('[Consultor Dashboard API] Buscando base completa do consultor (sem filtro de data na API)...');

          while (hasMore && currentPage <= maxPages) {
            const leadsApiUrl = new URL(`${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`);
            leadsApiUrl.searchParams.append('consultant', consultorProfile.email);
            leadsApiUrl.searchParams.append('per_page', perPage.toString());
            leadsApiUrl.searchParams.append('page', currentPage.toString());
            leadsApiUrl.searchParams.append('transferred_filter', 'no');
            // Não envia from/to: API externa pode retornar 404 com esses parâmetros

            const leadsResponse = await fetch(leadsApiUrl.toString(), {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey && { 'X-API-KEY': apiKey }),
              },
              signal: AbortSignal.timeout(60000),
            });

            if (!leadsResponse.ok) {
              if (leadsResponse.status === 404 && currentPage === 1) {
                console.log('[Consultor Dashboard API] 404 - Nenhum lead encontrado');
                break;
              }
              if (leadsResponse.status === 404) {
                hasMore = false;
                break;
              }
              const errorText = await leadsResponse.text();
              console.error(`[Consultor Dashboard API] Erro HTTP ${leadsResponse.status} na página ${currentPage}:`, errorText);
              if (allLeads.length > 0) {
                console.warn(`[Consultor Dashboard API] Erro na página ${currentPage}, mas retornando ${allLeads.length} leads já coletados`);
                break;
              }
              throw new Error(`Erro ao buscar dados da API da banca: ${leadsResponse.status}`);
            }

            const leadsData = await leadsResponse.json();

            if (!leadsData.success || !Array.isArray(leadsData.data)) {
              if (allLeads.length > 0) break;
              throw new Error('Formato de resposta inválido da API da banca');
            }

            const pageLeads = leadsData.data || [];

            if (pageLeads.length < perPage || pageLeads.length === 0) {
              hasMore = false;
            }

            allLeads = allLeads.concat(pageLeads);
            console.log(`[Consultor Dashboard API] Página ${currentPage} carregada: ${pageLeads.length} leads (Total acumulado: ${allLeads.length})`);

            if (!hasMore) break;
            currentPage++;
          }

          console.log(`[Consultor Dashboard API] Total de leads da base completa: ${allLeads.length}. Filtro por período será aplicado localmente (${searchBy}).`);

          // Processa os leads coletados
          if (allLeads.length > 0) {
            console.log('\n========================================');
            console.log('[Consultor Dashboard API] 🎯 INICIANDO PROCESSO DE FILTRAGEM');
            console.log('========================================');
            console.log(`📊 Total de leads recebidos da API: ${allLeads.length}`);
            console.log(`🔍 Modo de busca: ${searchBy === 'last_deposit_at' ? 'Último depósito' : 'Data de cadastro'}`);
            console.log(`📅 Período selecionado: ${dateFrom || 'sem início'} até ${dateTo || 'sem fim'}`);
            console.log('========================================\n');
            
            let filteredLeads = allLeads;
            const initialCount = allLeads.length;
            const filteredOut: Array<{ lead: any; reason: string }> = [];
              
            const saoPauloTimeZone = 'America/Sao_Paulo';

            // Filtro por período: aplicado localmente (base já veio completa da API, sem from/to)
            if (searchBy === 'last_deposit_at' && (dateFrom || dateTo)) {
              console.log(`\n[FILTRO 1] 🔍 Filtrando por último depósito (last_deposit_at)`);
              console.log(`   Período: ${dateFrom || 'sem início'} até ${dateTo || 'sem fim'}`);

              const beforeFilter = filteredLeads.length;
              filteredLeads = filteredLeads.filter((lead: any) => {
                if (!lead.last_deposit_at) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome' },
                    reason: 'Sem data de último depósito (last_deposit_at vazio)'
                  });
                  return false;
                }

                const depositDate = new Date(lead.last_deposit_at);
                const depositDateSP = new Date(depositDate.toLocaleString('en-US', { timeZone: saoPauloTimeZone }));
                const depositDateStr = depositDateSP.toISOString().split('T')[0];

                if (dateFrom && depositDateStr < dateFrom) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome', last_deposit_at: depositDateStr },
                    reason: `Último depósito (${depositDateStr}) anterior ao período inicial (${dateFrom})`
                  });
                  return false;
                }
                if (dateTo && depositDateStr > dateTo) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome', last_deposit_at: depositDateStr },
                    reason: `Último depósito (${depositDateStr}) posterior ao período final (${dateTo})`
                  });
                  return false;
                }
                return true;
              });

              const afterFilter = filteredLeads.length;
              console.log(`   ✅ Leads antes do filtro: ${beforeFilter}`);
              console.log(`   ✅ Leads após o filtro: ${afterFilter}`);
              console.log(`   ❌ Leads filtrados: ${beforeFilter - afterFilter}`);
              if (filteredOut.length > 0 && filteredOut.length <= 10) {
                console.log(`   📋 Exemplos de leads filtrados:`);
                filteredOut.slice(0, 10).forEach((item, idx) => {
                  console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
                });
              } else if (filteredOut.length > 10) {
                console.log(`   📋 Primeiros 10 leads filtrados (de ${filteredOut.length} total):`);
                filteredOut.slice(0, 10).forEach((item, idx) => {
                  console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
                });
              }
            } else if (searchBy === 'created_at' && (dateFrom || dateTo)) {
              console.log(`\n[FILTRO 1] 🔍 Filtrando por data de cadastro (created_at)`);
              console.log(`   Período: ${dateFrom || 'sem início'} até ${dateTo || 'sem fim'}`);

              const beforeFilter = filteredLeads.length;
              filteredLeads = filteredLeads.filter((lead: any) => {
                if (!lead.created_at) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome' },
                    reason: 'Sem data de cadastro (created_at vazio)'
                  });
                  return false;
                }

                const createdDate = new Date(lead.created_at);
                const createdDateSP = new Date(createdDate.toLocaleString('en-US', { timeZone: saoPauloTimeZone }));
                const createdDateStr = createdDateSP.toISOString().split('T')[0];

                if (dateFrom && createdDateStr < dateFrom) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome', created_at: createdDateStr },
                    reason: `Cadastro (${createdDateStr}) anterior ao período inicial (${dateFrom})`
                  });
                  return false;
                }
                if (dateTo && createdDateStr > dateTo) {
                  filteredOut.push({
                    lead: { id: lead.id, name: lead.name || 'Sem nome', created_at: createdDateStr },
                    reason: `Cadastro (${createdDateStr}) posterior ao período final (${dateTo})`
                  });
                  return false;
                }
                return true;
              });

              const afterFilter = filteredLeads.length;
              console.log(`   ✅ Leads antes do filtro: ${beforeFilter}`);
              console.log(`   ✅ Leads após o filtro: ${afterFilter}`);
              console.log(`   ❌ Leads filtrados: ${beforeFilter - afterFilter}`);
              if (filteredOut.length > 0 && filteredOut.length <= 10) {
                console.log(`   📋 Exemplos de leads filtrados:`);
                filteredOut.slice(0, 10).forEach((item, idx) => {
                  console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
                });
              } else if (filteredOut.length > 10) {
                console.log(`   📋 Primeiros 10 leads filtrados (de ${filteredOut.length} total):`);
                filteredOut.slice(0, 10).forEach((item, idx) => {
                  console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
                });
              }
            } else {
              console.log(`\n[FILTRO 1] ⏭️  Sem filtro de período`);
              console.log(`   Motivo: ${searchBy === 'created_at' ? 'Busca por data de cadastro' : 'Busca por último depósito'}; período: ${(dateFrom || dateTo) ? `${dateFrom || '?'} a ${dateTo || '?'}` : 'não informado (todo o período)'}`);
            }
            
            // Filtra fantasmas
            console.log(`\n[FILTRO 2] 👻 Filtrando clientes "fantasma"`);
            console.log(`   Critério: total_depositado = 0, total_apostado = 0, total_ganho = 0, total_depositos_count = 1`);
            
            const beforeGhostFilter = filteredLeads.length;
            const ghostFilteredOut: Array<{ lead: any; reason: string }> = [];
            
            filteredLeads = filteredLeads.filter((lead: any) => {
              const totalDepositado = parseFloat(lead.total_depositado) || 0;
              const totalApostado = parseFloat(lead.total_apostado) || 0;
              const totalGanho = parseFloat(lead.total_ganho) || 0;
              const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
              
              const isGhost = totalDepositado === 0 && 
                             totalApostado === 0 && 
                             totalGanho === 0 && 
                             totalDepositosCount === 1;
              
              if (isGhost) {
                ghostFilteredOut.push({
                  lead: { 
                    id: lead.id, 
                    name: lead.name || 'Sem nome',
                    total_depositado: totalDepositado,
                    total_apostado: totalApostado,
                    total_ganho: totalGanho,
                    total_depositos_count: totalDepositosCount
                  },
                  reason: 'Cliente fantasma (depósito único de 0 sem movimentação)'
                });
                return false;
              }
              
              return true;
            });
            
            const afterGhostFilter = filteredLeads.length;
            console.log(`   ✅ Leads antes do filtro: ${beforeGhostFilter}`);
            console.log(`   ✅ Leads após o filtro: ${afterGhostFilter}`);
            console.log(`   ❌ Leads filtrados: ${beforeGhostFilter - afterGhostFilter}`);
            
            if (ghostFilteredOut.length > 0 && ghostFilteredOut.length <= 10) {
              console.log(`   📋 Exemplos de leads filtrados:`);
              ghostFilteredOut.slice(0, 10).forEach((item, idx) => {
                console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
              });
            } else if (ghostFilteredOut.length > 10) {
              console.log(`   📋 Primeiros 10 leads filtrados (de ${ghostFilteredOut.length} total):`);
              ghostFilteredOut.slice(0, 10).forEach((item, idx) => {
                console.log(`      ${idx + 1}. Lead ID ${item.lead.id} (${item.lead.name}): ${item.reason}`);
              });
            }
            
            console.log('\n========================================');
            console.log('[Consultor Dashboard API] ✅ FILTRAGEM CONCLUÍDA');
            console.log('========================================');
            console.log(`📊 Total inicial: ${initialCount} leads`);
            console.log(`✅ Total final após filtros: ${filteredLeads.length} leads`);
            console.log(`❌ Total filtrado: ${initialCount - filteredLeads.length} leads`);
            console.log(`📈 Taxa de retenção: ${initialCount > 0 ? ((filteredLeads.length / initialCount) * 100).toFixed(2) : 0}%`);
            console.log('========================================\n');

              // ============================================
              // CALCULA ENGAJAMENTO BASEADO EM total_depositos_count
              // ============================================
              const engagementStatsNew = {
                deposit_1x: 0,      // total_depositos_count = 1
                deposit_2x: 0,      // total_depositos_count = 2
                deposit_3x: 0,      // total_depositos_count >= 3 e < 5
                deposit_5x: 0,      // total_depositos_count >= 5 e < 10
                deposit_10x: 0,     // total_depositos_count >= 10
              };

              filteredLeads.forEach((lead: any) => {
                const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
                
                if (totalDepositosCount === 1) {
                  engagementStatsNew.deposit_1x++;
                } else if (totalDepositosCount === 2) {
                  engagementStatsNew.deposit_2x++;
                } else if (totalDepositosCount >= 3 && totalDepositosCount < 5) {
                  engagementStatsNew.deposit_3x++;
                } else if (totalDepositosCount >= 5 && totalDepositosCount < 10) {
                  engagementStatsNew.deposit_5x++;
                } else if (totalDepositosCount >= 10) {
                  engagementStatsNew.deposit_10x++;
                }
              });

              // ============================================
              // CALCULA KPIs (Depósitos, Apostas, Prêmios)
              // ============================================
              const totalLeads = filteredLeads.length;
              
              // Se searchBy for 'last_deposit_at', usa last_deposit_value; caso contrário, usa total_depositado
              const totalDeposited = searchBy === 'last_deposit_at' 
                ? filteredLeads.reduce((sum: number, lead: any) => {
                    const lastDepositValue = parseFloat(lead.last_deposit_value) || 0;
                    return sum + lastDepositValue;
                  }, 0)
                : filteredLeads.reduce((sum: number, lead: any) => sum + (parseFloat(lead.total_depositado) || 0), 0);
              
              console.log(`\n💰 Cálculo de Total Depositado:`);
              console.log(`   Modo: ${searchBy === 'last_deposit_at' ? 'Soma de last_deposit_value' : 'Soma de total_depositado'}`);
              console.log(`   Total depositado: R$ ${totalDeposited.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
              
              const totalBets = filteredLeads.reduce((sum: number, lead: any) => sum + (parseFloat(lead.total_apostado) || 0), 0);
              const totalPrizes = filteredLeads.reduce((sum: number, lead: any) => sum + (parseFloat(lead.total_ganho) || 0), 0);
              const activeLeads = filteredLeads.filter((lead: any) => lead.status === 'ativo' || lead.temperature === 'active').length;
              
              // Clientes Premiados (clientes que ganharam algo)
              const clientesPremiados = filteredLeads.filter((lead: any) => {
                const totalGanho = parseFloat(lead.total_ganho) || 0;
                return totalGanho > 0;
              }).length;
              
              // LTV Médio (Lifetime Value médio = total depositado / total de leads)
              const ltvMedio = totalLeads > 0 ? totalDeposited / totalLeads : 0;

              // ============================================
              // BUSCA SAQUES DE CADA LEAD (API SEPARADA)
              // ============================================
              console.log('[Consultor Dashboard API] Buscando saques de', filteredLeads.length, 'leads...');
              
              // Busca saques em paralelo para todos os leads que têm odds_user_id
              const withdrawalPromises = filteredLeads
                .filter((lead: any) => lead.odds_user_id)
                .map((lead: any) => getUserWithdrawals(cleanBancaUrl, lead.odds_user_id, apiKey));
              
              const withdrawalResults = await Promise.all(withdrawalPromises);
              const totalWithdrawals = withdrawalResults.reduce((sum, val) => sum + val, 0);

              console.log('[Consultor Dashboard API] Total de saques calculado:', totalWithdrawals);
              
              externalKpis = {
                total_leads: totalLeads,
                total_deposited: totalDeposited,
                total_bets: totalBets,
                total_prizes: totalPrizes,
                total_withdrawals: totalWithdrawals,
                active_leads: activeLeads,
                net_profit: totalDeposited - totalWithdrawals, // Lucro Líquido = Depósitos - Saques
                conversion_rate: totalLeads > 0 ? (activeLeads / totalLeads) * 100 : 0,
                clientes_premiados: clientesPremiados,
                ltv_medio: ltvMedio,
              };

              // ============================================
              // CALCULA ATIVIDADE POR DIA DA SEMANA
              // ============================================
              const weekdayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
              const weekdayCount: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
              
              filteredLeads.forEach((lead: any) => {
                if (lead.created_at) {
                  const leadDate = new Date(lead.created_at);
                  const dayOfWeek = leadDate.getDay(); // 0 = Domingo, 1 = Segunda, etc.
                  weekdayCount[dayOfWeek]++;
                }
              });

              const activityByWeekday = {
                weekdays: weekdayNames,
                values: weekdayNames.map((_, idx) => weekdayCount[idx])
              };

              // ============================================
              // CALCULA FUNIL DE CONVERSÃO
              // ============================================
              // Estágios do funil baseados no comportamento dos leads
              const funnelStats = {
                cadastrados: totalLeads,
                depositaram: 0,
                ativos: 0,
                recorrentes: 0
              };

              filteredLeads.forEach((lead: any) => {
                const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
                const totalDepositado = parseFloat(lead.total_depositado) || 0;
                const isActive = lead.status === 'ativo' || lead.temperature === 'active';

                // Quem depositou pelo menos uma vez
                if (totalDepositosCount >= 1 || totalDepositado > 0) {
                  funnelStats.depositaram++;
                }

                // Quem está ativo
                if (isActive) {
                  funnelStats.ativos++;
                }

                // Quem depositou 2 ou mais vezes (recorrente)
                if (totalDepositosCount >= 2) {
                  funnelStats.recorrentes++;
                }
              });

              const conversionFunnel = {
                stages: ['Cadastrados', 'Depositaram', 'Ativos', 'Recorrentes'],
                values: [
                  funnelStats.cadastrados,
                  funnelStats.depositaram,
                  funnelStats.ativos,
                  funnelStats.recorrentes
                ]
              };

              // ============================================
              // CALCULA TOP GANHADORES (Top 10)
              // ============================================
              interface TopPerformer {
                name: string;
                phone: string;
                value: number;
              }
              
              const topGanadores: TopPerformer[] = filteredLeads
                .map((lead: any) => ({
                  name: (lead.name || '') + (lead.last_name ? ` ${lead.last_name}` : ''),
                  phone: lead.phone || lead.whatsapp || '',
                  value: parseFloat(lead.total_ganho) || 0
                }))
                .filter((item: TopPerformer) => item.value > 0) // Só inclui quem realmente ganhou
                .sort((a: TopPerformer, b: TopPerformer) => b.value - a.value)
                .slice(0, 10);

              // ============================================
              // CALCULA TOP DEPOSITANTES (Top 10)
              // ============================================
              // Se searchBy for 'last_deposit_at', usa last_deposit_value; caso contrário, usa total_depositado
              const topDepositantes: TopPerformer[] = filteredLeads
                .map((lead: any) => ({
                  name: (lead.name || '') + (lead.last_name ? ` ${lead.last_name}` : ''),
                  phone: lead.phone || lead.whatsapp || '',
                  value: searchBy === 'last_deposit_at' 
                    ? (parseFloat(lead.last_deposit_value) || 0)
                    : (parseFloat(lead.total_depositado) || 0)
                }))
                .filter((item: TopPerformer) => item.value > 0) // Só inclui quem realmente depositou
                .sort((a: TopPerformer, b: TopPerformer) => b.value - a.value)
                .slice(0, 10);
              
              console.log(`\n🏆 Top Depositantes calculado:`);
              console.log(`   Modo: ${searchBy === 'last_deposit_at' ? 'Usando last_deposit_value' : 'Usando total_depositado'}`);
              console.log(`   Total de leads no ranking: ${topDepositantes.length}`);
              if (topDepositantes.length > 0) {
                console.log(`   Top 3:`);
                topDepositantes.slice(0, 3).forEach((item, idx) => {
                  console.log(`      ${idx + 1}. ${item.name}: R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                });
              }

              // ============================================
              // CALCULA DISTRIBUIÇÃO DE CLIENTES ESTRELAS (apenas clientes ativos)
              // ============================================
              const starsDistribution: Record<string, number> = {};
              const activeLeadsForStars = filteredLeads.filter((lead: any) => lead.status === 'ativo' || lead.temperature === 'active');
              activeLeadsForStars.forEach((lead: any) => {
                const stars = parseInt(lead.user_level || lead.stars || '0') || 0;
                const starKey = `${stars} Estrela${stars !== 1 ? 's' : ''}`;
                starsDistribution[starKey] = (starsDistribution[starKey] || 0) + 1;
              });

              // ============================================
              // CALCULA CLIENTES AFILIADOS
              // ============================================
              const clientesAfiliados = filteredLeads.filter((lead: any) => {
                return !!lead.affiliate_name || lead.is_affiliate === true || 
                       lead.affiliate === 'yes' || lead.affiliate_filter === 'yes';
              }).length;

              // ============================================
              // MONTA chartData COM TODOS OS GRÁFICOS
              // ============================================
              chartData = {
                engagement_distribution: {
                  "Deposito 1x": engagementStatsNew.deposit_1x,
                  "Deposito 2x": engagementStatsNew.deposit_2x,
                  "Deposito 3x": engagementStatsNew.deposit_3x,
                  "Deposito 5x": engagementStatsNew.deposit_5x,
                  "Deposito 10x+": engagementStatsNew.deposit_10x
                },
                status_distribution: {
                  "Ativo": activeLeads,
                  "Novo": Math.max(0, totalLeads - activeLeads)
                },
                activity_by_weekday: activityByWeekday,
                conversion_funnel: conversionFunnel,
                top_ganhadores: topGanadores,
                top_depositantes: topDepositantes,
                stars_distribution: starsDistribution,
                clientes_afiliados: clientesAfiliados
              };

              console.log('[Consultor Dashboard API] ✅ Gráficos calculados dos leads:', {
                totalLeads,
                totalWithdrawals,
                engagement: engagementStats,
                activityByWeekday: activityByWeekday.values,
                funnel: funnelStats
              });
          } else {
            // Caso não haja leads coletados (base vazia ou erro na busca)
            console.log('[Consultor Dashboard API] Nenhum lead encontrado');
            externalKpis = {
              total_leads: 0,
              total_deposited: 0,
              total_bets: 0,
              total_prizes: 0,
              total_withdrawals: 0,
              active_leads: 0,
              conversion_rate: 0,
              net_profit: 0,
            };
            chartData = {
              engagement_distribution: {},
              status_distribution: {},
              activity_by_weekday: { weekdays: [], values: [] },
              conversion_funnel: { stages: [], values: [] },
              top_ganhadores: [],
              top_depositantes: [],
              stars_distribution: {},
              clientes_afiliados: 0
            };
          }
        } catch (error: any) {
          console.error('[Consultor Dashboard API] Erro ao buscar leads:', error.message);
          externalKpisError = 'Consultor não cadastrado na banca selecionada';
        }
      }
    }

    return successResponse({
      externalKpis,
      externalKpisError,
      chartData,
    });
  } catch (err: any) {
    console.error('[Consultor Dashboard API] Erro:', err.message);
    return errorResponse(err.message || 'Erro ao buscar dados do dashboard', 401);
  }
}
