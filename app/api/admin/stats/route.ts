import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { rateLimitService } from '@/lib/services/rate-limit-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

/** Alinhado a app/instances e Evolution: DB pode armazenar ok; API às vezes usa connected/open/ready. */
function isEvolutionInstanceConnected(row: { status?: string | null; is_active?: boolean | null }) {
  if (row.is_active === false) return false;
  const s = String(row.status ?? '').toLowerCase().trim();
  return (
    s === 'ok' ||
    s === 'connected' ||
    s === 'open' ||
    s === 'ready' ||
    s === 'online'
  );
}

/**
 * GET /api/admin/stats - Retorna estatísticas gerais do sistema.
 * Acesso: super_admin, admin, dono_banca (requireAdmin).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);

    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));

    const { data: tenantProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);
    const tenantUserIds = (tenantProfiles || []).map((p: { id: string }) => p.id);

    if (tenantUserIds.length === 0) {
      return successResponse({
        overview: { totalUsers: 0, totalCampaigns: 0, totalContacts: 0, totalInstances: 0, totalGroups: 0 },
        campaigns: { total: 0, running: 0, paused: 0, completed: 0, failed: 0, totalProcessed: 0, totalFailed: 0, totalAdded: 0, successRate: 0 },
        instances: { total: 0, connected: 0, disconnected: 0 },
        contacts: { total: 0, pending: 0, added: 0, sent: 0 },
        dispatches: { dispatchedToday: 0, nextExecutions: 0, failures: 0, successTotal: 0 },
        chartData: [],
      });
    }

    /**
     * Escopo de instâncias alinhado ao isolamento por tenant:
     * - evolution_instances.zaploto_id = tenant (principal após enforce_tenant_isolation)
     * - OU user_id pertence a um perfil do tenant (legado / linhas sem zaploto_id)
     *
     * Antes só usávamos user_id IN (...), o que zerava totais quando havia instâncias com
     * user_id nulo ou só zaploto_id preenchido — enquanto GET /api/admin/evolution/instances lista todas.
     */
    const instanceTenantOrFilter = `zaploto_id.eq.${zaplotoId},user_id.in.(${tenantUserIds.join(',')})`;

    // Busca todas as estatísticas (filtradas por tenant)
    const [
      usersResult,
      campaignsResult,
      contactsResult,
      instancesResult,
      groupsResult,
      campaignsData,
      instancesData,
      contactsData,
      dispatchedTodayResult,
      nextExecutionsResult,
      dispatchesFailedResult,
      dispatchesSuccessTotalResult,
    ] = await Promise.all([
      supabaseServiceRole.from('profiles').select('id', { count: 'exact', head: true }).or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`),
      supabaseServiceRole.from('campaigns').select('id', { count: 'exact', head: true }).in('user_id', tenantUserIds),
      supabaseServiceRole.from('searches').select('id', { count: 'exact', head: true }).in('user_id', tenantUserIds),
      supabaseServiceRole.from('evolution_instances').select('id', { count: 'exact', head: true }).or(instanceTenantOrFilter),
      supabaseServiceRole.from('whatsapp_groups').select('id', { count: 'exact', head: true }).in('user_id', tenantUserIds),
      supabaseServiceRole
        .from('campaigns')
        .select('status, processed_contacts, failed_contacts, total_contacts')
        .in('user_id', tenantUserIds),
      supabaseServiceRole
        .from('evolution_instances')
        .select('status, is_active')
        .or(instanceTenantOrFilter),
      supabaseServiceRole
        .from('campaign_contacts')
        .select('status'),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', startOfTodayUtc.toISOString())
        .lt('sent_at', endOfTodayUtc.toISOString()),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .in('status', ['scheduled', 'processing'])
        .gt('next_run_utc', now.toISOString()),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent'),
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

    // Instâncias conectadas (status ok/connected/open; exclui só is_active === false)
    const connectedInstances = instancesData?.data?.filter(isEvolutionInstanceConnected).length || 0;
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
      dispatches: {
        dispatchedToday: dispatchedTodayResult?.count ?? 0,
        nextExecutions: nextExecutionsResult?.count ?? 0,
        failures: dispatchesFailedResult?.count ?? 0,
        successTotal: dispatchesSuccessTotalResult?.count ?? 0,
      },
      chartData,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

