import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/clear-all-data
 * Remove todos os dados operacionais da conta e do dashboard:
 * - campaign_contacts (contatos das campanhas)
 * - message_schedules (disparos/agendamentos)
 * - campaigns (campanhas)
 * - searches (buscas/contatos)
 * Acesso: apenas super_admin.
 */
export async function POST(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin']);

    // Ordem respeitando FKs: campaign_contacts -> campaigns; message_schedules e searches são independentes
    const { error: errContacts } = await supabaseServiceRole
      .from('campaign_contacts')
      .delete().neq('id', '00000000-0000-0000-0000-000000000000'); // delete all

    if (errContacts) {
      console.error('[clear-all-data] campaign_contacts:', errContacts.message);
      return errorResponse(`Erro ao limpar contatos das campanhas: ${errContacts.message}`, 500);
    }

    const { error: errSchedules } = await supabaseServiceRole
      .from('message_schedules')
      .delete().neq('id', '00000000-0000-0000-0000-000000000000');

    if (errSchedules) {
      console.error('[clear-all-data] message_schedules:', errSchedules.message);
      return errorResponse(`Erro ao limpar agendamentos: ${errSchedules.message}`, 500);
    }

    const { error: errCampaigns } = await supabaseServiceRole
      .from('campaigns')
      .delete().neq('id', '00000000-0000-0000-0000-000000000000');

    if (errCampaigns) {
      console.error('[clear-all-data] campaigns:', errCampaigns.message);
      return errorResponse(`Erro ao limpar campanhas: ${errCampaigns.message}`, 500);
    }

    const { error: errSearches } = await supabaseServiceRole
      .from('searches')
      .delete().neq('id', '00000000-0000-0000-0000-000000000000');

    if (errSearches) {
      console.error('[clear-all-data] searches:', errSearches.message);
      return errorResponse(`Erro ao limpar buscas: ${errSearches.message}`, 500);
    }

    return successResponse(
      { cleared: ['campaign_contacts', 'message_schedules', 'campaigns', 'searches'] },
      'Todos os dados da conta e do dashboard foram limpos.'
    );
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
