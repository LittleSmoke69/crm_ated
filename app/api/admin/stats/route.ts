import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { rateLimitService } from '@/lib/services/rate-limit-service';

/**
 * GET /api/admin/stats - Retorna estatísticas gerais do sistema.
 * Acesso: super_admin, admin, dono_banca (requireAdmin).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);

    // Busca todas as estatísticas
    const [
      usersResult,
      campaignsResult,
      contactsResult,
      instancesResult,
      groupsResult,
      campaignsData,
      instancesData,
      contactsData,
    ] = await Promise.all([
      supabaseServiceRole.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseServiceRole.from('campaigns').select('id', { count: 'exact', head: true }),
      supabaseServiceRole.from('searches').select('id', { count: 'exact', head: true }),
      // Usa a nova tabela evolution_instances para contagem
      supabaseServiceRole.from('evolution_instances').select('id', { count: 'exact', head: true }),
      supabaseServiceRole.from('whatsapp_groups').select('id', { count: 'exact', head: true }),
      supabaseServiceRole
        .from('campaigns')
        .select('status, processed_contacts, failed_contacts, total_contacts'),
      // Busca status das instâncias do novo sistema
      supabaseServiceRole
        .from('evolution_instances')
        .select('status, is_active'),
      supabaseServiceRole
        .from('campaign_contacts')
        .select('status'),
    ]);

    const totalUsers = usersResult?.count || 0;
    const totalCampaigns = campaignsResult?.count || 0;
    const totalContacts = contactsResult?.count || 0;
    const totalInstances = instancesResult?.count || 0;
    const totalGroups = groupsResult?.count || 0;

    // Calcula métricas
    const runningCampaigns = campaignsData?.data?.filter(c => c.status === 'running').length || 0;
    const pausedCampaigns = campaignsData?.data?.filter(c => c.status === 'paused').length || 0;
    const completedCampaigns = campaignsData?.data?.filter(c => c.status === 'completed').length || 0;
    const failedCampaigns = campaignsData?.data?.filter(c => c.status === 'failed').length || 0;
    
    const totalProcessed = campaignsData?.data?.reduce((sum, c) => sum + (c.processed_contacts || 0), 0) || 0;
    const totalFailed = campaignsData?.data?.reduce((sum, c) => sum + (c.failed_contacts || 0), 0) || 0;
    const totalAdded = campaignsData?.data?.reduce((sum, c) => sum + (c.total_contacts || 0), 0) || 0;

    // Conta instâncias ativas e com status ok
    const connectedInstances = instancesData?.data?.filter(i => i.is_active && i.status === 'ok').length || 0;
    const pendingContacts = contactsData?.data?.filter(c => c.status === 'queued').length || 0;
    const addedContacts = contactsData?.data?.filter(c => c.status === "success").length || 0;
    const sentMessages = contactsData?.data?.filter(c => c.status === "asd").length || 0;

    // Taxa de sucesso
    const successRate = totalAdded > 0 
      ? Math.round((totalProcessed / totalAdded) * 100) 
      : 0;

    // Busca dados históricos para o gráfico (últimos 7 dias)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: historicalCampaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('created_at, processed_contacts, failed_contacts, total_contacts')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: true });

    // Agrupa por dia
    const chartData: { date: string; adicionados: number; falhas: number }[] = [];
    const dateMap = new Map<string, { adicionados: number; falhas: number }>();

    // Inicializa os últimos 7 dias
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dateMap.set(dateStr, { adicionados: 0, falhas: 0 });
    }

    // Processa campanhas
    historicalCampaigns?.forEach((campaign) => {
      const dateStr = campaign.created_at.split('T')[0];
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.adicionados += campaign.processed_contacts || 0;
        existing.falhas += campaign.failed_contacts || 0;
      }
    });

    // Converte para array
    dateMap.forEach((value, key) => {
      const date = new Date(key);
      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      chartData.push({
        date: `${date.getDate()}/${monthNames[date.getMonth()]}`,
        adicionados: value.adicionados,
        falhas: value.falhas,
      });
    });

    return successResponse({
      overview: {
        totalUsers: totalUsers || 0,
        totalCampaigns: totalCampaigns || 0,
        totalContacts: totalContacts || 0,
        totalInstances: totalInstances || 0,
        totalGroups: totalGroups || 0,
      },
      campaigns: {
        total: totalCampaigns || 0,
        running: runningCampaigns,
        paused: pausedCampaigns,
        completed: completedCampaigns,
        failed: failedCampaigns,
        totalProcessed,
        totalFailed,
        totalAdded,
        successRate,
      },
      instances: {
        total: totalInstances || 0,
        connected: connectedInstances,
        disconnected: (totalInstances || 0) - connectedInstances,
      },
      contacts: {
        total: totalContacts || 0,
        pending: pendingContacts,
        added: addedContacts,
        sent: sentMessages,
      },
      chartData,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

