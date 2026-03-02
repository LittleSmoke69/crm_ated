import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/campaigns/[campaignId]/history
 * Lista o histórico de contatos da campanha: número, status, motivo (erro ou "Adicionado ao grupo"), data, instância.
 * Apenas administradores.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { campaignId } = await params;
    if (!campaignId) {
      return errorResponse('campaignId é obrigatório', 400);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess =
      profile?.status === 'super_admin' ||
      profile?.status === 'admin' ||
      profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const statusFilter = searchParams.get('status'); // success | failed | queued
    const offset = (page - 1) * limit;

    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns')
      .select('id, group_subject')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    let query = supabaseServiceRole
      .from('campaign_contacts')
      .select('id, phone, status, last_error, finished_at, instance_name, position, created_at', {
        count: 'exact',
      })
      .eq('campaign_id', campaignId)
      .order('position', { ascending: true })
      .range(offset, offset + limit - 1);

    if (statusFilter === 'success' || statusFilter === 'failed' || statusFilter === 'queued') {
      query = query.eq('status', statusFilter);
    }

    const { data: contacts, error, count } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar histórico: ${error.message}`, 500);
    }

    const items = (contacts || []).map((c: any) => ({
      id: c.id,
      phone: c.phone || '',
      status: c.status,
      reason:
        c.status === 'success'
          ? 'Adicionado ao grupo'
          : c.status === 'failed'
            ? c.last_error || 'Erro ao adicionar'
            : 'Na fila',
      finished_at: c.finished_at || null,
      instance_name: c.instance_name || null,
      position: c.position ?? 0,
      created_at: c.created_at,
    }));

    return successResponse({
      campaign_id: campaignId,
      group_subject: campaign.group_subject,
      items,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar histórico', 500);
  }
}
