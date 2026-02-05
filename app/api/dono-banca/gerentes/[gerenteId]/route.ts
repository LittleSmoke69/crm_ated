import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';

/**
 * Normaliza a URL da banca removendo barras finais e protocolos duplicados
 */
function normalizeBancaUrl(bancaUrl: string): string {
  if (!bancaUrl) return bancaUrl;
  let normalized = bancaUrl.trim();
  normalized = normalized.replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  normalized = normalized.replace(/\/+$/, '').trim();
  if (normalized) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

/**
 * GET /api/dono-banca/gerentes/[gerenteId]
 * Retorna campanhas e métricas dos consultores abaixo de um gerente específico
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gerenteId: string }> }
) {
  let gerenteId: string | undefined;
  const startTime = Date.now();
  
  try {
    const { userId: ownerId } = await requireStatus(req, ['dono_banca']);
    const resolvedParams = await params;
    gerenteId = resolvedParams.gerenteId;

    // Busca parâmetros de data da query string
    const { searchParams } = req.nextUrl;
    let dateFrom = searchParams.get('date_from');
    let dateTo = searchParams.get('date_to');

    // Se não foram fornecidos parâmetros de data, usa a data de hoje
    if (!dateFrom || !dateTo) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      dateFrom = dateFrom || todayStr;
      dateTo = dateTo || todayStr;
      console.log('[Gerente Detail API] 📅 Filtros de data não fornecidos - usando data de hoje:', todayStr);
    }

    console.log('[Gerente Detail API] 🚀 Iniciando busca de dados do gerente');
    console.log('[Gerente Detail API] 👤 Gerente ID:', gerenteId);
    console.log('[Gerente Detail API] 📅 Filtros:', { dateFrom, dateTo });

    // 1. Verifica se o gerente pertence à banca
    const isOwner = await isInHierarchy(ownerId, gerenteId!);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este gerente não pertence à sua banca.', 403);
    }

    // 2. Busca dados do Gerente
    const { data: gerente } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', gerenteId!)
      .single();

    console.log('[Gerente Detail API] 👔 Gerente encontrado:', gerente?.email || 'N/A');

    // 3. Busca Consultores do Gerente
    const { data: consultores } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('enroller', gerenteId!)
      .eq('status', 'consultor');

    console.log('[Gerente Detail API] 👥 Total de consultores encontrados:', consultores?.length || 0);

    const consultorIds = consultores?.map(c => c.id) || [];
    const allIds = [gerenteId!, ...consultorIds];

    // 4. Busca todas as campanhas da estrutura desse gerente
    const { data: campaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .in('user_id', allIds)
      .order('created_at', { ascending: false });

    // 4.1. Busca banca_url do dono de banca
    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    const bancaUrl = donoProfile?.banca_url;
    const apiKey = process.env.CRM_API_KEY;

    if (!bancaUrl) {
      console.log('[Gerente Detail API] ⚠️ Banca URL não configurada');
    } else {
      const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
      console.log('[Gerente Detail API] 🔗 URL da banca:', cleanBancaUrl);
      console.log('[Gerente Detail API] 🔑 API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'não configurada');
    }

    // 5. Métricas por consultor
    console.log('[Gerente Detail API] 📊 Buscando métricas dos consultores...');
    const metricsByConsultor = await Promise.all(
      (consultores || []).map(async (c) => {
        const { data: cCampaigns } = await supabaseServiceRole
          .from('campaigns')
          .select('processed_contacts, failed_contacts')
          .eq('user_id', c.id);

        const processed = cCampaigns?.reduce((s, camp) => s + (camp.processed_contacts || 0), 0) || 0;
        const failed = cCampaigns?.reduce((s, camp) => s + (camp.failed_contacts || 0), 0) || 0;

        // Busca KPIs da API externa usando o email do consultor
        let externalKpis = null;
        let externalKpisError: string | null = null;
        
        if (bancaUrl && c.email) {
          try {
            const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
            const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
            externalApiUrl.searchParams.append('consultant', c.email);
            
            // Sempre adiciona parâmetros de data (já garantidos acima que não são null)
            externalApiUrl.searchParams.append('date_from', dateFrom!);
            externalApiUrl.searchParams.append('date_to', dateTo!);

            const requestUrl = externalApiUrl.toString();
            const consultorStartTime = Date.now();
            
            console.log('[Gerente Detail API] 📊 Buscando métricas do consultor:', c.email);
            console.log('[Gerente Detail API] 🔗 URL:', requestUrl);

            const externalResponse = await fetch(requestUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(apiKey && { 'X-API-KEY': apiKey }),
              },
            });

            const consultorResponseTime = Date.now() - consultorStartTime;

            if (externalResponse.ok) {
              const externalData = await externalResponse.json();
              console.log('[Gerente Detail API] ✅ Resposta recebida para', c.email);
              console.log('[Gerente Detail API] 📈 Status:', externalResponse.status, externalResponse.statusText);
              console.log('[Gerente Detail API] ⏱️  Tempo de resposta:', `${consultorResponseTime}ms`);
              
              if (externalData.success && externalData.metrics) {
                const metrics = externalData.metrics;
                externalKpis = {
                  total_leads: metrics.total_leads || 0,
                  total_deposited: metrics.total_deposited || 0,
                  total_bets: metrics.total_bets || 0,
                  total_prizes: metrics.total_prizes || 0,
                  active_leads: metrics.active_leads || 0,
                  conversion_rate: metrics.conversion_rate || 0,
                  net_profit: metrics.net_profit || 0,
                };
                
                console.log('[Gerente Detail API] ✅ Consultor', c.email, `: ${externalKpis.total_leads} leads, R$ ${(externalKpis.total_deposited / 1000).toFixed(1)}k depositado (${consultorResponseTime}ms)`);
                console.log('[Gerente Detail API] 📊 Métricas recebidas:', {
                  total_leads: externalKpis.total_leads,
                  total_deposited: externalKpis.total_deposited,
                  total_bets: externalKpis.total_bets,
                  total_prizes: externalKpis.total_prizes,
                  active_leads: externalKpis.active_leads,
                  conversion_rate: externalKpis.conversion_rate,
                  net_profit: externalKpis.net_profit,
                });
              } else {
                externalKpisError = 'Dados não disponíveis';
                console.log('[Gerente Detail API] ⚠️ Dados não disponíveis para', c.email);
              }
            } else {
              const errorText = await externalResponse.text();
              externalKpisError = `Erro ${externalResponse.status}: ${errorText.substring(0, 50)}`;
              console.log('[Gerente Detail API] ❌ Erro ao buscar métricas de', c.email, `: ${externalResponse.status}`);
            }
          } catch (error: any) {
            console.error('[Gerente Detail API] ❌ Erro ao buscar KPIs do consultor:', c.email);
            console.error('[Gerente Detail API] Erro:', error.message);
            externalKpisError = error.message || 'Erro ao buscar KPIs';
          }
        } else {
          if (!bancaUrl) {
            console.log('[Gerente Detail API] ⚠️ Banca URL não configurada para consultor:', c.email);
          }
          if (!c.email) {
            console.log('[Gerente Detail API] ⚠️ Consultor sem email:', c.id);
          }
        }

        return {
          id: c.id,
          email: c.email,
          name: c.full_name || c.email,
          campaignsCount: cCampaigns?.length || 0,
          processed,
          failed,
          successRate: processed > 0 ? ((processed - failed) / processed * 100).toFixed(2) : '0.00',
          externalKpis,
          externalKpisError,
        };
      })
    );

    // 6. Calcula métricas consolidadas do gerente (soma de todos os consultores)
    console.log('[Gerente Detail API] 📊 Calculando métricas consolidadas do gerente...');
    const gerenteTotalKpis = metricsByConsultor.reduce((acc, consultor) => {
      if (consultor.externalKpis && !consultor.externalKpisError) {
        acc.total_leads = (acc.total_leads || 0) + (consultor.externalKpis.total_leads || 0);
        acc.total_deposited = (acc.total_deposited || 0) + (consultor.externalKpis.total_deposited || 0);
        acc.total_bets = (acc.total_bets || 0) + (consultor.externalKpis.total_bets || 0);
        acc.total_prizes = (acc.total_prizes || 0) + (consultor.externalKpis.total_prizes || 0);
        acc.active_leads = (acc.active_leads || 0) + (consultor.externalKpis.active_leads || 0);
        acc.net_profit = (acc.net_profit || 0) + (consultor.externalKpis.net_profit || 0);
      }
      return acc;
    }, {
      total_leads: 0,
      total_deposited: 0,
      total_bets: 0,
      total_prizes: 0,
      active_leads: 0,
      net_profit: 0,
    } as {
      total_leads: number;
      total_deposited: number;
      total_bets: number;
      total_prizes: number;
      active_leads: number;
      net_profit: number;
    });

    // Calcula taxa de conversão geral (baseada nos leads ativos vs total)
    const conversionRate = gerenteTotalKpis.total_leads > 0 
      ? (gerenteTotalKpis.active_leads / gerenteTotalKpis.total_leads) * 100 
      : 0;

    const gerenteTotalKpisWithConversion = {
      ...gerenteTotalKpis,
      conversion_rate: conversionRate,
    };

    console.log('[Gerente Detail API] ✅ SOMA FINAL do gerente', gerente?.email, `(${consultores?.length || 0} consultores):`, {
      total_leads: gerenteTotalKpisWithConversion.total_leads,
      total_deposited: `R$ ${(gerenteTotalKpisWithConversion.total_deposited / 1000).toFixed(1)}k`,
      net_profit: `R$ ${(gerenteTotalKpisWithConversion.net_profit / 1000).toFixed(1)}k`,
      conversion_rate: `${gerenteTotalKpisWithConversion.conversion_rate.toFixed(2)}%`,
    });

    const totalTime = Date.now() - startTime;
    
    console.log('[Gerente Detail API] 📋 Resumo das requisições:');
    console.log('[Gerente Detail API]   ✅ Métricas dos consultores:', `${consultores?.length || 0} consultores`);
    console.log('[Gerente Detail API]   📊 API: /api/crm/dashboard-metrics');
    console.log('[Gerente Detail API]   📅 Filtros aplicados:', `date_from=${dateFrom || 'N/A'}, date_to=${dateTo || 'N/A'}`);
    console.log('[Gerente Detail API]   ⚡ OTIMIZAÇÃO: Requisições em paralelo para métricas dos consultores');
    console.log('[Gerente Detail API]   ⏱️  Tempo total de processamento:', `${totalTime}ms`);
    console.log('[Gerente Detail API] 🎉 Processamento concluído!');

    return successResponse({
      gerente,
      campaigns,
      consultorMetrics: metricsByConsultor,
      gerenteTotalKpis: gerenteTotalKpisWithConversion,
    });
  } catch (err: any) {
    const totalTime = Date.now() - startTime;
    console.error('[Gerente Detail API] ❌ Erro:', err.message);
    console.error('[Gerente Detail API] Stack:', err.stack);
    console.error('[Gerente Detail API] GerenteId:', gerenteId);
    console.error('[Gerente Detail API] ⏱️  Tempo até erro:', `${totalTime}ms`);
    return serverErrorResponse(err);
  }
}

