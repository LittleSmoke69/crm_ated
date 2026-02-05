import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.NEXT_PUBLIC_WEBHOOK_URL || 'https://n8n-n8n.nw2oy0.easypanel.host/webhook/0e08a315-6400-4d8f-a779-3c5964f49bcb';

/**
 * POST /api/send-webhook - Envia dados da campanha para webhook externo
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { campaignId, groupId, groupSubject, strategy, telefones, jobs } = body || {};

    if (!campaignId || !groupId || !strategy || !Array.isArray(telefones) || telefones.length === 0) {
      return errorResponse('campaignId, groupId, strategy e telefones são obrigatórios', 400);
    }

    // Busca dados completos da campanha
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .eq('user_id', userId)
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Monta o payload para o webhook incluindo os dados da campanha
    const payload = {
      campaignId,
      userId,
      groupId,
      groupSubject: groupSubject || campaign.group_subject || null,
      strategy,
      telefones,
      jobs: jobs || [],
      campaign: {
        id: campaignId,
        totalContacts: campaign.total_contacts,
        processedContacts: campaign.processed_contacts,
        failedContacts: campaign.failed_contacts,
        status: campaign.status,
        instances: campaign.instances,
        createdAt: campaign.created_at,
      },
    };

    // Envia para o webhook
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({} as any));

    if (!response.ok) {
      // Atualiza status da campanha para failed
      await supabaseServiceRole
        .from('campaigns')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', campaignId);

      const errorMsg = responseData?.error || responseData?.message || `Erro HTTP ${response.status}`;
      return errorResponse(errorMsg, response.status);
    }

    // Atualiza status da campanha para running
    await supabaseServiceRole
      .from('campaigns')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    return successResponse(
      responseData,
      `Webhook enviado com sucesso. ${telefones.length} contato(s) processado(s).`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

