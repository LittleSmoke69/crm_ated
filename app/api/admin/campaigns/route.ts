import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Recalcula métricas de todas as campanhas usando COUNT por campanha (evita limite de linhas do PostgREST).
 * Fonte da verdade: campaign_contacts (status = success | failed).
 */
async function recalculateAllCampaignsMetrics(
  campaignIds: string[]
): Promise<Record<string, { processed: number; failed: number }> | null> {
  if (campaignIds.length === 0) return {};

  const byCampaign: Record<string, { processed: number; failed: number }> = {};
  for (const id of campaignIds) {
    byCampaign[id] = { processed: 0, failed: 0 };
  }

  const countPromises = campaignIds.flatMap((campaignId) => [
    supabaseServiceRole
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'success'),
    supabaseServiceRole
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'failed'),
  ]);
  const countResults = await Promise.all(countPromises);

  campaignIds.forEach((campaignId, i) => {
    const successRes = countResults[i * 2];
    const failedRes = countResults[i * 2 + 1];
    byCampaign[campaignId].processed = (successRes as { count?: number })?.count ?? 0;
    byCampaign[campaignId].failed = (failedRes as { count?: number })?.count ?? 0;
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
      console.error('[Admin Campaigns] Erro Supabase:', error.message, 'code:', error.code);
      return errorResponse(
        `Erro ao buscar campanhas: ${error.message}`,
        500
      );
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

