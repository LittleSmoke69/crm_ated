import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Recalcula métricas de todas as campanhas em uma única operação (1 query + updates paralelos).
 * Não bloqueia com retries longos: em falha de rede, retorna null e a resposta usa métricas já salvas no DB.
 */
async function recalculateAllCampaignsMetrics(
  campaignIds: string[]
): Promise<Record<string, { processed: number; failed: number }> | null> {
  if (campaignIds.length === 0) return {};

  const { data: jobRows, error } = await supabaseServiceRole
    .from('campaign_contacts')
    .select('campaign_id, status')
    .in('campaign_id', campaignIds);

  if (error) {
    console.warn(`⚠️ Erro ao buscar campaign_contacts para recálculo (admin list):`, error.message);
    // Retorna null para usar métricas já salvas na tabela campaigns
    return null;
  }

  const byCampaign: Record<string, { processed: number; failed: number }> = {};
  for (const id of campaignIds) {
    byCampaign[id] = { processed: 0, failed: 0 };
  }
  (jobRows || []).forEach((row: { campaign_id: string; status: string }) => {
    if (!byCampaign[row.campaign_id]) return;
    if (row.status === 'success') byCampaign[row.campaign_id].processed++;
    else if (row.status === 'failed') byCampaign[row.campaign_id].failed++;
  });

  const now = new Date().toISOString();
  try {
    await Promise.all(
      campaignIds.map((id) =>
        supabaseServiceRole
          .from('campaigns')
          .update({
            processed_contacts: byCampaign[id].processed,
            failed_contacts: byCampaign[id].failed,
            updated_at: now,
          })
          .eq('id', id)
      )
    );
  } catch (err) {
    console.warn('⚠️ Erro ao persistir métricas recalculadas (admin list):', (err as Error)?.message);
    // Retorna as métricas calculadas mesmo assim; a resposta fica correta
  }

  return byCampaign;
}

/**
 * GET /api/admin/campaigns - Lista todas as campanhas do sistema
 * Recalcula métricas de cada campanha antes de retornar para garantir dados atualizados
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    // Verifica se é admin através do campo status na tabela profiles
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const userIdFilter = searchParams.get('userId');

    // Busca campanhas
    let query = supabaseServiceRole
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (userIdFilter) {
      query = query.eq('user_id', userIdFilter);
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar campanhas: ${error.message}`);
    }

    if (!campaigns || campaigns.length === 0) {
      return successResponse([]);
    }

    const campaignIds = campaigns.map((c) => c.id);
    const metricsMap = await recalculateAllCampaignsMetrics(campaignIds);

    const userIds = [...new Set(campaigns.map((c) => c.user_id).filter(Boolean))] as string[];
    const { data: profilesList } =
      userIds.length > 0
        ? await supabaseServiceRole
            .from('profiles')
            .select('id, email, full_name')
            .in('id', userIds)
        : { data: [] };
    const profileById = (profilesList || []).reduce((acc: Record<string, any>, p) => {
      acc[p.id] = p;
      return acc;
    }, {});

    const campaignsWithMetrics = campaigns.map((campaign) => {
      const metrics = metricsMap
        ? metricsMap[campaign.id]
        : { processed: campaign.processed_contacts ?? 0, failed: campaign.failed_contacts ?? 0 };
      return {
        ...campaign,
        processed_contacts: metrics?.processed ?? campaign.processed_contacts ?? 0,
        failed_contacts: metrics?.failed ?? campaign.failed_contacts ?? 0,
        profiles: profileById[campaign.user_id] ?? null,
      };
    });

    return successResponse(campaignsWithMetrics);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

