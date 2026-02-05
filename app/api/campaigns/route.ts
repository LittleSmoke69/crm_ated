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
    // Garante que a UI mostre os números corretos mesmo se updateAggregates não tiver rodado
    if (campaignIds.length > 0) {
      const { data: jobStats } = await supabaseServiceRole
        .from('campaign_contacts')
        .select('campaign_id, status')
        .in('campaign_id', campaignIds);

      const metricsByCampaign = new Map<string, { processed: number; failed: number }>();
      for (const id of campaignIds) {
        metricsByCampaign.set(id, { processed: 0, failed: 0 });
      }
      (jobStats || []).forEach((row: any) => {
        const m = metricsByCampaign.get(row.campaign_id);
        if (!m) return;
        if (row.status === 'success') m.processed++;
        else if (row.status === 'failed') m.failed++;
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

