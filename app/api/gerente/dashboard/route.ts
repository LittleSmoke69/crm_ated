import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getHierarchyPath, isInHierarchy } from '@/lib/utils/hierarchy';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

/** Extrai apenas o slug da URL (subdomínio ou hostname sem TLD) para verificação e exibição, igual ao uso no top 5 vendas. */
function urlToSlug(url: string | null | undefined): string {
  if (!url || !String(url).trim()) return '';
  try {
    let u = String(url).trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
    u = u.replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '');
    const hostname = new URL(u).hostname;
    const parts = hostname.split('.');
    if (parts.length >= 3) return parts[0].toLowerCase();
    if (parts.length >= 2) return parts[0].toLowerCase();
    return hostname.toLowerCase();
  } catch {
    const withoutProtocol = String(url).replace(/^https?:\/\//i, '').split('/')[0] || '';
    return withoutProtocol.split('.')[0]?.toLowerCase() || '';
  }
}

/**
 * Busca métricas de um consultor com retry automático para erros 429
 */
async function fetchConsultorMetrics(
  cleanBancaUrl: string,
  consultantEmail: string,
  dateFromParam: string | null,
  dateToParam: string | null,
  apiKey: string | undefined,
  apiKeyPreview: string,
  maxRetries: number = 2,
  retryDelay: number = 2000
): Promise<{ success: boolean; data: any; error: string | null; status: number | null }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const metricsApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
      metricsApiUrl.searchParams.append('consultant', consultantEmail);
      
      if (dateFromParam) {
        metricsApiUrl.searchParams.append('date_from', dateFromParam);
      }
      if (dateToParam) {
        metricsApiUrl.searchParams.append('date_to', dateToParam);
      }
      
      const requestUrl = metricsApiUrl.toString();
      const consultorStartTime = Date.now();
      
      if (attempt > 0) {
        console.log(`[Gerente Dashboard API] 🔄 Tentativa ${attempt + 1}/${maxRetries + 1} para ${consultantEmail}`);
        // Aguarda antes de tentar novamente (exponencial backoff)
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
      
      console.log('[Gerente Dashboard API] 🔗 URL:', requestUrl);
      console.log('[Gerente Dashboard API] 📅 Filtros:', { 
        dateFrom: dateFromParam, 
        dateTo: dateToParam,
        consultant: consultantEmail
      });
      console.log('[Gerente Dashboard API] 🔑 API Key:', apiKeyPreview);
      console.log('[Gerente Dashboard API] 👤 Buscando métricas do consultor:', consultantEmail);

      const metricsResponse = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(apiKey && { 'X-API-KEY': apiKey }),
        },
      });
      
      const consultorResponseTime = Date.now() - consultorStartTime;

      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        
        console.log('[Gerente Dashboard API] ✅ Resposta recebida');
        console.log('[Gerente Dashboard API] 📈 Status:', metricsResponse.status, metricsResponse.statusText);
        console.log('[Gerente Dashboard API] ⏱️  Tempo de resposta:', `${consultorResponseTime}ms`);
        
        // Processa a resposta da API dashboard-metrics
        let metrics = null;
        if (metricsData.success && metricsData.metrics) {
          metrics = metricsData.metrics;
        } else if (metricsData.metrics) {
          metrics = metricsData.metrics;
        } else if (metricsData.total_leads !== undefined || metricsData.total_deposited !== undefined) {
          metrics = metricsData;
        }

        if (metrics) {
          return {
            success: true,
            data: metrics,
            error: null,
            status: metricsResponse.status
          };
        } else {
          return {
            success: false,
            data: null,
            error: 'Formato de resposta inválido da API',
            status: metricsResponse.status
          };
        }
      } else if (metricsResponse.status === 429 && attempt < maxRetries) {
        // Erro 429 - Too Many Requests, vai tentar novamente
        const errorText = await metricsResponse.text();
        console.log(`[Gerente Dashboard API] ⚠️ Rate limit (429) para ${consultantEmail}, tentativa ${attempt + 1}/${maxRetries + 1}`);
        console.log('[Gerente Dashboard API] ⏱️  Tempo de resposta:', `${consultorResponseTime}ms`);
        // Continua o loop para tentar novamente
        continue;
      } else {
        // Outro erro ou esgotou as tentativas
        const errorText = await metricsResponse.text();
        console.log('[Gerente Dashboard API] ❌ Erro ao buscar métricas de', consultantEmail, `: ${metricsResponse.status}`);
        console.log('[Gerente Dashboard API] ⏱️  Tempo de resposta:', `${consultorResponseTime}ms`);
        return {
          success: false,
          data: null,
          error: `Erro ${metricsResponse.status}: ${errorText.substring(0, 50)}`,
          status: metricsResponse.status
        };
      }
    } catch (error: any) {
      if (attempt < maxRetries) {
        console.log(`[Gerente Dashboard API] ⚠️ Erro na tentativa ${attempt + 1} para ${consultantEmail}, tentando novamente...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      console.error('[Gerente Dashboard API] Erro ao buscar métricas do consultor:', error.message);
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao buscar métricas',
        status: null
      };
    }
  }
  
  // Se chegou aqui, esgotou todas as tentativas
  return {
    success: false,
    data: null,
    error: 'Erro 429: Muitas requisições. Tente novamente mais tarde.',
    status: 429
  };
}

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
    console.error('[Gerente Dashboard API] Erro ao buscar saques do usuário:', error);
    return 0;
  }
}

/**
 * GET /api/gerente/dashboard
 * Retorna dashboard do gerente com KPIs externos e métricas dos consultores
 * Calcula TODOS os gráficos diretamente dos dados do CRM de cada consultor
 * Busca saques de cada lead usando API separada
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'gestor', 'super_admin', 'admin']);
    let effectiveUserId = userId;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    // super_admin/admin: gerente_id na query define o gerente cujo dashboard será exibido; banca_url recomendado
    if (isAdminOrSuperAdmin) {
      const gerenteIdParam = req.nextUrl.searchParams.get('gerente_id')?.trim();
      if (gerenteIdParam) {
        const { data: gerenteProfile } = await supabaseServiceRole
          .from('profiles')
          .select('id, status')
          .eq('id', gerenteIdParam)
          .single();
        if (gerenteProfile?.status === 'gerente') {
          effectiveUserId = gerenteIdParam;
        }
      }
    }

    // Gestor: deve enviar X-Effective-Gerente-Id para ver o dashboard desse gerente (acesso ao CRM dos gerentes da banca)
    if (profile?.status === 'gestor') {
      const effectiveGerenteId = (req.headers.get('X-Effective-Gerente-Id') ?? req.headers.get('x-effective-gerente-id'))?.trim();
      if (!effectiveGerenteId) {
        return errorResponse('Gestor deve informar o gerente (header X-Effective-Gerente-Id) para acessar o dashboard.', 400);
      }
      let ownerId: string | null = await getEffectiveDonoIdForGestor(profile.id);
      if (!ownerId) {
        const profileId = profile.id;
        let { data: ubRow } = await supabaseServiceRole
          .from('user_bancas')
          .select('banca_ids')
          .eq('user_id', profileId)
          .maybeSingle();
        if (!ubRow?.banca_ids?.length) {
          const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
          ubRow = fallback ?? ubRow;
        }
        const bancaIdsArr = Array.isArray(ubRow?.banca_ids) ? ubRow.banca_ids : [];
        const firstBancaId = bancaIdsArr[0];
        if (firstBancaId) {
          const { data: banca } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url')
            .eq('id', firstBancaId)
            .single();
          if (banca?.url) {
            const { data: donos } = await supabaseServiceRole
              .from('profiles')
              .select('id, banca_url')
              .eq('status', 'dono_banca');
            const found = (donos || []).find(
              (d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === normalizeBancaUrl(banca.url)
            );
            if (found) ownerId = found.id;
          }
        }
      }
      if (!ownerId) {
        return errorResponse('Gestor deve estar vinculado a um Dono de Banca ou ter bancas atribuídas.', 403);
      }
      const canAccess = await isInHierarchy(ownerId, effectiveGerenteId);
      if (!canAccess) {
        return errorResponse('Acesso negado. Este gerente não pertence à sua banca.', 403);
      }
      effectiveUserId = effectiveGerenteId;
    }

    // Busca parâmetros da query string
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaUrlFilter = searchParams.get('banca_url'); // Filtro de banca
    const consultorIdFilter = searchParams.get('consultor_id'); // Filtro de consultor
    const offsetParam = searchParams.get('offset');
    const limitParam = searchParams.get('limit');
    const usePagination = limitParam != null && limitParam !== '';
    const offset = usePagination ? Math.max(0, parseInt(offsetParam || '0', 10)) : 0;
    const limit = usePagination ? Math.max(1, Math.min(100, parseInt(limitParam || '10', 10))) : 0;

    console.log('[Gerente Dashboard API] 🚀 Iniciando busca de métricas');
    console.log('[Gerente Dashboard API] 📅 Filtros recebidos:', { 
      dateFrom, 
      dateTo, 
      bancaUrl: bancaUrlFilter || 'não informado',
      consultorId: consultorIdFilter || 'todos'
    });

    // 1. Lista de URLs de banca(s) e mapa slug -> rótulo (slug apenas, sem domínio; mesma verificação do top 5 vendas).
    let bancaUrls: string[] = [];
    const bancaSlugToLabel: Record<string, string> = {};

    if (bancaUrlFilter) {
      bancaUrls = [bancaUrlFilter];
    } else {
      // Gerente sem banca_url = "Todas as bancas": usar TODAS as bancas de user_bancas (pesquisar em todas).
      if (profile?.status === 'gerente') {
        const { data: ubRow } = await supabaseServiceRole
          .from('user_bancas')
          .select('banca_ids')
          .eq('user_id', effectiveUserId)
          .maybeSingle();
        const bancaIds = Array.isArray(ubRow?.banca_ids) ? ubRow.banca_ids : [];
        if (bancaIds.length > 0) {
          const { data: bancas } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, name, url')
            .in('id', bancaIds);
          const list = (bancas || []) as { id: string; name: string; url: string }[];
          bancaUrls = list.map((b) => b.url).filter(Boolean);
          list.forEach((b) => {
            if (b.url) {
              const slug = urlToSlug(b.url);
              if (slug) bancaSlugToLabel[slug] = slug;
            }
          });
        }
      }

      // Se não é gerente ou user_bancas está vazio: fallback hierarquia / primeira banca
      if (bancaUrls.length === 0) {
        const hierarchyPath = await getHierarchyPath(effectiveUserId);
        const donoBanca = hierarchyPath.find(p => p.status === 'dono_banca');
        let bancaUrl: string | null = null;

        if (donoBanca) {
          const { data: donoProfile } = await supabaseServiceRole
            .from('profiles')
            .select('banca_url, banca_name')
            .eq('id', donoBanca.id)
            .single();
          bancaUrl = donoProfile?.banca_url ?? null;
        }

        if (!bancaUrl) {
          const { data: ubRow } = await supabaseServiceRole
            .from('user_bancas')
            .select('banca_ids')
            .eq('user_id', effectiveUserId)
            .maybeSingle();
          const bancaIds = Array.isArray(ubRow?.banca_ids) ? ubRow.banca_ids : [];
          if (bancaIds.length > 0) {
            const { data: banca } = await supabaseServiceRole
              .from('crm_bancas')
              .select('id, name, url')
              .eq('id', bancaIds[0])
              .single();
            if (banca?.url) {
              bancaUrls = [banca.url];
              const slug = urlToSlug(banca.url);
              if (slug) bancaSlugToLabel[slug] = slug;
            }
          }
        } else {
          bancaUrls = [bancaUrl];
        }
      }
    }
    const apiKey = process.env.CRM_API_KEY;
    
    // Log da API Key (mascarada)
    const apiKeyPreview = apiKey 
      ? `${apiKey.substring(0, 8)}...` 
      : 'não configurada';
    console.log('[Gerente Dashboard API] 🔑 API Key:', apiKeyPreview);

    // 3. Busca consultores do gerente (filtrado se necessário)
    let consultores = await getConsultorsByManager(effectiveUserId);
    
    // Filtra por consultor específico se fornecido
    if (consultorIdFilter) {
      consultores = consultores.filter(c => c.id === consultorIdFilter);
    }

    const totalConsultores = consultores.length;
    if (usePagination) {
      consultores = consultores.slice(offset, offset + limit);
      console.log(`[Gerente Dashboard API] 👥 Paginação: processando consultores ${offset + 1}-${offset + consultores.length} de ${totalConsultores} (offset=${offset}, limit=${limit})`);
    } else {
      console.log('[Gerente Dashboard API] 👥 Total de consultores encontrados:', totalConsultores);
    }

    // 4. Métricas por consultor com KPIs externos — processa em lotes de 10 para evitar rate limit e sobrecarga
    const CONSULTORES_BATCH_SIZE = 5;
    const consultorMetrics: Awaited<ReturnType<typeof buildConsultorMetric>>[] = [];

    async function buildConsultorMetric(c: (typeof consultores)[0]) {
      const { data: cCampaigns } = await supabaseServiceRole
        .from('campaigns')
        .select('processed_contacts, failed_contacts')
        .eq('user_id', c.id);

      const processed = cCampaigns?.reduce((s, camp) => s + (camp.processed_contacts || 0), 0) || 0;
      const failed = cCampaigns?.reduce((s, camp) => s + (camp.failed_contacts || 0), 0) || 0;

      let externalKpis: {
        total_leads: number;
        total_deposited: number;
        total_bets: number;
        total_prizes: number;
        awarded_clients_count: number;
        active_leads: number;
        conversion_rate: number;
        ltv_avg: number;
        net_profit: number;
      } | null = null;
      let externalKpisError: string | null = null;
      let statusCode: number | null = null;
      let totalLeadsForLtv = 0;
      let sumLtvWeighted = 0;
      const bancaNames: string[] = [];

      if (bancaUrls.length > 0 && c.email) {
        for (const bancaUrlItem of bancaUrls) {
          let cleanBancaUrl = bancaUrlItem.trim();
          if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
            cleanBancaUrl = `https://${cleanBancaUrl}`;
          }
          cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');

          const result = await fetchConsultorMetrics(
            cleanBancaUrl,
            c.email,
            dateFrom,
            dateTo,
            apiKey,
            apiKeyPreview,
            2,
            2000
          );

          statusCode = result.status;

          if (result.success && result.data) {
            const slug = urlToSlug(cleanBancaUrl);
            const label = slug ? (bancaSlugToLabel[slug] || slug) : '';
            if (label && !bancaNames.includes(label)) bancaNames.push(label);
            const m = result.data;
            const totalLeads = Number(m.total_leads) || 0;
            const totalDeposited = Number(m.total_deposited) || 0;
            const totalBets = Number(m.total_bets) || 0;
            const totalPrizes = Number(m.total_prizes) || 0;
            const awardedClientsCount = Number(m.awarded_clients_count) || 0;
            const activeLeads = Number(m.active_leads) || 0;
            const conversionRate = Number(m.conversion_rate) || 0;
            const ltvAvg = Number(m.ltv_avg) || 0;
            const netProfit = Number(m.net_profit) || 0;

            if (!externalKpis) {
              externalKpis = {
                total_leads: totalLeads,
                total_deposited: totalDeposited,
                total_bets: totalBets,
                total_prizes: totalPrizes,
                awarded_clients_count: awardedClientsCount,
                active_leads: activeLeads,
                conversion_rate: conversionRate,
                ltv_avg: ltvAvg,
                net_profit: netProfit,
              };
              if (totalLeads > 0) {
                sumLtvWeighted = ltvAvg * totalLeads;
                totalLeadsForLtv = totalLeads;
              }
            } else {
              externalKpis.total_leads += totalLeads;
              externalKpis.total_deposited += totalDeposited;
              externalKpis.total_bets += totalBets;
              externalKpis.total_prizes += totalPrizes;
              externalKpis.awarded_clients_count += awardedClientsCount;
              externalKpis.active_leads += activeLeads;
              externalKpis.net_profit += netProfit;
              if (totalLeads > 0) {
                sumLtvWeighted += ltvAvg * totalLeads;
                totalLeadsForLtv += totalLeads;
              }
            }
            console.log('[Gerente Dashboard API] ✅ Consultor', c.email, `(${cleanBancaUrl}): ${totalLeads} leads, R$ ${(totalDeposited / 1000).toFixed(1)}k depositado`);
          } else {
            externalKpisError = result.error ?? externalKpisError;
            if (result.status === 429) {
              console.log('[Gerente Dashboard API] ⚠️ Consultor', c.email, 'marcado para retry (429)');
            }
          }
        }

        if (externalKpis && totalLeadsForLtv > 0) {
          externalKpis.ltv_avg = sumLtvWeighted / totalLeadsForLtv;
        }
        if (externalKpis && externalKpis.total_leads > 0) {
          externalKpis.conversion_rate = (externalKpis.active_leads / externalKpis.total_leads) * 100;
        }
      }

      return {
        id: c.id,
        email: c.email,
        name: c.full_name || c.email,
        campaignsCount: cCampaigns?.length || 0,
        processed,
        failed,
        successRate: processed > 0
          ? ((processed - failed) / processed * 100).toFixed(2)
          : '0.00',
        externalKpis,
        externalKpisError,
        statusCode,
        lastSeenAt: (c as { last_seen_at?: string | null }).last_seen_at ?? null,
        totalOnlineTime: (c as { total_online_time?: number | null }).total_online_time ?? 0,
        totalCrmTime: (c as { total_crm_time?: number | null }).total_crm_time ?? 0,
        ...(bancaNames.length > 0 && { banca_names: bancaNames }),
      };
    }

    for (let i = 0; i < consultores.length; i += CONSULTORES_BATCH_SIZE) {
      const chunk = consultores.slice(i, i + CONSULTORES_BATCH_SIZE);
      const batchNum = Math.floor(i / CONSULTORES_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(consultores.length / CONSULTORES_BATCH_SIZE);
      console.log(`[Gerente Dashboard API] 📦 Processando consultores ${i + 1}-${i + chunk.length} de ${consultores.length} (lote ${batchNum}/${totalBatches})`);
      const batchResults = await Promise.all(chunk.map(buildConsultorMetric));
      consultorMetrics.push(...batchResults);
    }

    // 4.5. Retry para consultores que falharam com erro 429 (apenas quando uma única banca)
    const failedConsultors = consultorMetrics.filter(c => c.externalKpisError && c.statusCode === 429);
    
    if (failedConsultors.length > 0 && bancaUrls.length === 1) {
      console.log(`[Gerente Dashboard API] 🔄 Iniciando retry para ${failedConsultors.length} consultores com erro 429`);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      let cleanBancaUrl = bancaUrls[0].trim();
      if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
        cleanBancaUrl = `https://${cleanBancaUrl}`;
      }
      cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');

      for (const failedConsultor of failedConsultors) {
        console.log(`[Gerente Dashboard API] 🔄 Retry para ${failedConsultor.email}`);
        
        const result = await fetchConsultorMetrics(
          cleanBancaUrl,
          failedConsultor.email,
          dateFrom,
          dateTo,
          apiKey,
          apiKeyPreview,
          2,
          2000
        );

        if (result.success && result.data) {
          const metrics = result.data;
          
          // Extrai todos os campos da API dashboard-metrics
          const totalLeads = Number(metrics.total_leads) || 0;
          const totalDeposited = Number(metrics.total_deposited) || 0;
          const totalBets = Number(metrics.total_bets) || 0;
          const totalPrizes = Number(metrics.total_prizes) || 0;
          const awardedClientsCount = Number(metrics.awarded_clients_count) || 0;
          const activeLeads = Number(metrics.active_leads) || 0;
          const conversionRate = Number(metrics.conversion_rate) || 0;
          const ltvAvg = Number(metrics.ltv_avg) || 0;
          const netProfit = Number(metrics.net_profit) || 0;
          
          // Atualiza os dados do consultor na lista
          const consultorIndex = consultorMetrics.findIndex(c => c.id === failedConsultor.id);
          if (consultorIndex !== -1) {
            consultorMetrics[consultorIndex].externalKpis = {
              total_leads: totalLeads,
              total_deposited: totalDeposited,
              total_bets: totalBets,
              total_prizes: totalPrizes,
              awarded_clients_count: awardedClientsCount,
              active_leads: activeLeads,
              conversion_rate: conversionRate,
              ltv_avg: ltvAvg,
              net_profit: netProfit,
            };
            consultorMetrics[consultorIndex].externalKpisError = null;
            consultorMetrics[consultorIndex].statusCode = result.status;
            
            console.log(`[Gerente Dashboard API] ✅ Retry bem-sucedido para ${failedConsultor.email}: ${totalLeads} leads, R$ ${(totalDeposited / 1000).toFixed(1)}k depositado`);
          }
        } else {
          console.log(`[Gerente Dashboard API] ❌ Retry falhou para ${failedConsultor.email}: ${result.error}`);
        }
        
        // Pequeno delay entre cada retry para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`[Gerente Dashboard API] ✅ Retry concluído para ${failedConsultors.length} consultores`);
    }

    // 5. Agrega KPIs de todos os consultores para o gerente
    // Soma todos os valores numéricos e calcula média ponderada para ltv_avg
    let totalLeadsForLtv = 0;
    let sumLtvWeighted = 0;
    
    const gerenteTotalKpis = consultorMetrics.reduce((acc, consultor) => {
      if (consultor.externalKpis && !consultor.externalKpisError) {
        const kpis = consultor.externalKpis;
        
        // Soma valores numéricos
        acc.total_leads = (acc.total_leads || 0) + (kpis.total_leads || 0);
        acc.total_deposited = (acc.total_deposited || 0) + (kpis.total_deposited || 0);
        acc.total_bets = (acc.total_bets || 0) + (kpis.total_bets || 0);
        acc.total_prizes = (acc.total_prizes || 0) + (kpis.total_prizes || 0);
        acc.awarded_clients_count = (acc.awarded_clients_count || 0) + (kpis.awarded_clients_count || 0);
        acc.active_leads = (acc.active_leads || 0) + (kpis.active_leads || 0);
        acc.net_profit = (acc.net_profit || 0) + (kpis.net_profit || 0);
        
        // Calcula média ponderada para ltv_avg (baseado no total de leads de cada consultor)
        if (kpis.ltv_avg && kpis.total_leads > 0) {
          sumLtvWeighted += (kpis.ltv_avg * kpis.total_leads);
          totalLeadsForLtv += kpis.total_leads;
        }
      }
      return acc;
    }, {
      total_leads: 0,
      total_deposited: 0,
      total_bets: 0,
      total_prizes: 0,
      awarded_clients_count: 0,
      active_leads: 0,
      net_profit: 0,
      ltv_avg: 0,
    } as {
      total_leads: number;
      total_deposited: number;
      total_bets: number;
      total_prizes: number;
      awarded_clients_count: number;
      active_leads: number;
      net_profit: number;
      ltv_avg: number;
    });

    // Calcula média ponderada do LTV
    gerenteTotalKpis.ltv_avg = totalLeadsForLtv > 0 
      ? sumLtvWeighted / totalLeadsForLtv 
      : 0;

    // Calcula taxa de conversão geral (baseada nos leads ativos vs total)
    const conversionRate = gerenteTotalKpis.total_leads > 0 
      ? (gerenteTotalKpis.active_leads / gerenteTotalKpis.total_leads) * 100 
      : 0;

    const gerenteTotalKpisWithConversion = {
      ...gerenteTotalKpis,
      conversion_rate: conversionRate,
    };

    // Log do resumo geral
    console.log('[Gerente Dashboard API] ✅ Métricas do RESUMO GERAL recebidas:', {
      total_leads: gerenteTotalKpisWithConversion.total_leads,
      total_deposited: gerenteTotalKpisWithConversion.total_deposited,
      total_bets: gerenteTotalKpisWithConversion.total_bets,
      total_prizes: gerenteTotalKpisWithConversion.total_prizes,
      awarded_clients_count: gerenteTotalKpisWithConversion.awarded_clients_count,
      active_leads: gerenteTotalKpisWithConversion.active_leads,
      conversion_rate: gerenteTotalKpisWithConversion.conversion_rate,
      ltv_avg: gerenteTotalKpisWithConversion.ltv_avg,
      net_profit: gerenteTotalKpisWithConversion.net_profit
    });
    
    console.log('[Gerente Dashboard API] 📊 Resumo Geral usará dados da API externa:', {
      'Total de Leads (API)': gerenteTotalKpisWithConversion.total_leads,
      'Total Depositado (API)': gerenteTotalKpisWithConversion.total_deposited,
      'Total Apostado (API)': gerenteTotalKpisWithConversion.total_bets,
      'Total Prêmios (API)': gerenteTotalKpisWithConversion.total_prizes,
      'Clientes Premiados (API)': gerenteTotalKpisWithConversion.awarded_clients_count,
      'Lucro Líquido (API)': gerenteTotalKpisWithConversion.net_profit,
      'Taxa de Conversão (API)': `${gerenteTotalKpisWithConversion.conversion_rate.toFixed(2)}%`,
      'LTV Médio (API)': gerenteTotalKpisWithConversion.ltv_avg
    });
    
    console.log('[Gerente Dashboard API] 📊 Fonte de dados:', {
      'Resumo Geral': 'API Externa (/api/crm/dashboard-metrics?consultant=...) agregado por consultor',
      'Métricas dos Consultores': 'API Externa (/api/crm/dashboard-metrics?consultant=...)'
    });

    // 6. Busca dados do gerente (reutilizado depois)
    const gerenteProfile = await getUserProfile(effectiveUserId);

    // ============================================
    // 7. MONTA chartData APENAS COM DADOS DO RESUMO GERAL
    // ============================================
    // Apenas gráficos que podem ser gerados com dados agregados do resumo geral
    const chartData = {
      status_distribution: {
        "Ativo": gerenteTotalKpisWithConversion.active_leads,
        "Novo": Math.max(0, gerenteTotalKpisWithConversion.total_leads - gerenteTotalKpisWithConversion.active_leads)
      },
      financial_metrics: {
        total_deposited: gerenteTotalKpisWithConversion.total_deposited,
        total_bets: gerenteTotalKpisWithConversion.total_bets,
        total_prizes: gerenteTotalKpisWithConversion.total_prizes,
        net_profit: gerenteTotalKpisWithConversion.net_profit
      }
    };

    console.log('[Gerente Dashboard API] ✅ Gráficos baseados no resumo geral:', {
      totalConsultores: consultores.length,
      totalLeads: gerenteTotalKpis.total_leads,
      statusDistribution: chartData.status_distribution,
      financialMetrics: chartData.financial_metrics
    });
    
    const totalTime = Date.now() - startTime;
    const successfulRequests = consultorMetrics.filter(c => c.externalKpis && !c.externalKpisError).length;
    const failedRequests = consultorMetrics.filter(c => c.externalKpisError).length;
    
    console.log('[Gerente Dashboard API] 📋 Resumo das requisições:');
    console.log('[Gerente Dashboard API]   ✅ Consultores processados:', consultores.length);
    console.log('[Gerente Dashboard API]   ✅ Requisições bem-sucedidas:', successfulRequests);
    if (failedRequests > 0) {
      console.log('[Gerente Dashboard API]   ❌ Requisições com erro:', failedRequests);
    }
    console.log('[Gerente Dashboard API]   ⚡ OTIMIZAÇÃO: Requisições em paralelo para métricas dos consultores');
    console.log('[Gerente Dashboard API]   📊 API: /api/crm/dashboard-metrics');
    console.log('[Gerente Dashboard API]   📅 Filtros aplicados:', {
      date_from: dateFrom || 'hoje',
      date_to: dateTo || 'hoje',
      banca_url: bancaUrlFilter || (bancaUrls.length > 0 ? (bancaUrls.length === 1 ? bancaUrls[0] : 'todas') : 'não informado'),
      consultor_id: consultorIdFilter || 'todos'
    });
    console.log('[Gerente Dashboard API]   ⏱️  Tempo total de processamento:', `${totalTime}ms`);
    console.log('[Gerente Dashboard API] 🎉 Processamento concluído!');

    if (usePagination) {
      const hasMore = offset + consultorMetrics.length < totalConsultores;
      return successResponse({
        gerenteInfo: {
          id: effectiveUserId,
          email: gerenteProfile?.email || '',
          name: gerenteProfile?.full_name || '',
        },
        consultorMetrics,
        totalConsultores,
        offset,
        limit,
        hasMore,
      });
    }

    return successResponse({
      gerenteInfo: {
        id: effectiveUserId,
        email: gerenteProfile?.email || '',
        name: gerenteProfile?.full_name || '',
      },
      consultorMetrics,
      gerenteTotalKpis: gerenteTotalKpisWithConversion,
      chartData,
    });
  } catch (err: any) {
    const totalTime = Date.now() - startTime;
    console.error('[Gerente Dashboard API] ❌ Erro:', err.message);
    console.error('[Gerente Dashboard API] Stack:', err.stack);
    console.error('[Gerente Dashboard API] ⏱️  Tempo até o erro:', `${totalTime}ms`);
    return serverErrorResponse(err);
  }
}

