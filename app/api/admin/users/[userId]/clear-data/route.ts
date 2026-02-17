import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/users/[userId]/clear-data
 * Remove todos os dados operacionais de um usuário específico:
 * - campaign_contacts (das campanhas do usuário)
 * - message_schedules (disparos do usuário)
 * - campaigns (campanhas do usuário)
 * - searches (buscas/contatos do usuário)
 * Acesso: admin ou super_admin.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(req);
    const { userId: targetUserId } = await params;
    if (!targetUserId) {
      return errorResponse('userId é obrigatório.', 400);
    }

    // Campanhas do usuário (para deletar campaign_contacts depois)
    const { data: userCampaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('id')
      .eq('user_id', targetUserId);
    const campaignIds = (userCampaigns || []).map((c: { id: string }) => c.id);

    if (campaignIds.length > 0) {
      const { error: errContacts } = await supabaseServiceRole
        .from('campaign_contacts')
        .delete()
        .in('campaign_id', campaignIds);
      if (errContacts) {
        console.error('[clear-user-data] campaign_contacts:', errContacts.message);
        return errorResponse(`Erro ao limpar contatos: ${errContacts.message}`, 500);
      }
    }

    const { error: errSchedules } = await supabaseServiceRole
      .from('message_schedules')
      .delete()
      .eq('user_id', targetUserId);
    if (errSchedules) {
      console.error('[clear-user-data] message_schedules:', errSchedules.message);
      return errorResponse(`Erro ao limpar agendamentos: ${errSchedules.message}`, 500);
    }

    const { error: errCampaigns } = await supabaseServiceRole
      .from('campaigns')
      .delete()
      .eq('user_id', targetUserId);
    if (errCampaigns) {
      console.error('[clear-user-data] campaigns:', errCampaigns.message);
      return errorResponse(`Erro ao limpar campanhas: ${errCampaigns.message}`, 500);
    }

    const { error: errSearches } = await supabaseServiceRole
      .from('searches')
      .delete()
      .eq('user_id', targetUserId);
    if (errSearches) {
      console.error('[clear-user-data] searches:', errSearches.message);
      return errorResponse(`Erro ao limpar buscas: ${errSearches.message}`, 500);
    }

    return successResponse(
      { cleared: ['campaign_contacts', 'message_schedules', 'campaigns', 'searches'] },
      'Dados do usuário foram limpos.'
    );
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
