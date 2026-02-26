import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/campaigns - Lista campanhas do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let query = supabaseServiceRole
      .from('campaigns')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar campanhas: ${error.message}`);
    }

    const campaigns = data || [];
    const campaignIds = campaigns.map((c: any) => c.id);

    // Recalcula processados/falhas a partir de campaign_contacts (fonte da verdade)
    // Usa COUNT por campanha para não depender do limite de 1000 linhas do PostgREST
    if (campaignIds.length > 0) {
      const metricsByCampaign = new Map<string, { processed: number; failed: number }>();
      for (const id of campaignIds) {
        metricsByCampaign.set(id, { processed: 0, failed: 0 });
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
        const m = metricsByCampaign.get(campaignId)!;
        const successRes = countResults[i * 2];
        const failedRes = countResults[i * 2 + 1];
        m.processed = successRes?.count ?? 0;
        m.failed = failedRes?.count ?? 0;
      });

      campaigns.forEach((c: any) => {
        const m = metricsByCampaign.get(c.id);
        if (m) {
          c.processed_contacts = m.processed;
          c.failed_contacts = m.failed;
        }
      });
    }

    return successResponse({
      campaigns: campaigns,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar campanhas', 401);
  }
}

/**
 * POST /api/campaigns - Cria uma nova campanha
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { groupId, groupSubject, totalContacts, strategy, instances } = body;

    if (!groupId || !totalContacts || !strategy || !Array.isArray(instances)) {
      return errorResponse('groupId, totalContacts, strategy e instances são obrigatórios', 400);
    }

    const { data: campaign, error } = await supabaseServiceRole
      .from('campaigns')
      .insert({
        user_id: userId,
        group_id: groupId,
        group_subject: groupSubject || null,
        status: 'pending',
        total_contacts: totalContacts,
        processed_contacts: 0,
        failed_contacts: 0,
        strategy: strategy,
        instances: instances,
      })
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao criar campanha: ${error.message}`);
    }

    return successResponse(campaign, 'Campanha criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

