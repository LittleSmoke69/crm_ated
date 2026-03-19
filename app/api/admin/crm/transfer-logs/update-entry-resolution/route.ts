/**
 * POST /api/admin/crm/transfer-logs/update-entry-resolution
 *
 * Atualiza o resolution_status de uma entry (vinculado ↔ disponivel_retransferencia).
 * Permite vincular manualmente à carteira do consultor ou reverter a vinculação.
 * Body: { log_id, banca_id, lead_id, new_status: 'vinculado' | 'disponivel_retransferencia' }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const VALID_STATUSES = ['vinculado', 'disponivel_retransferencia'] as const;

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { log_id?: string; banca_id?: string; lead_id?: string; new_status?: string } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const logId = body.log_id?.trim();
    const bancaId = body.banca_id?.trim();
    const leadId = body.lead_id != null ? String(body.lead_id).trim() : '';
    const newStatus = body.new_status?.trim();

    if (!logId || !bancaId || !leadId || !newStatus) {
      return errorResponse('log_id, banca_id, lead_id e new_status são obrigatórios.');
    }

    if (!VALID_STATUSES.includes(newStatus as (typeof VALID_STATUSES)[number])) {
      return errorResponse('new_status deve ser vinculado ou disponivel_retransferencia.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.');

    const { data: entry, error: findError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('id, resolution_status')
      .eq('transfer_log_id', logId)
      .eq('banca_id', resolved.bancaId)
      .eq('lead_id', leadId)
      .single();

    if (findError || !entry) {
      return errorResponse('Entry não encontrada.');
    }

    const current = (entry as { resolution_status?: string | null }).resolution_status;
    if (current === 'pending') {
      return errorResponse('Entry ainda no prazo. Resolva a transferência primeiro.');
    }

    const { error: updateError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({
        resolution_status: newStatus,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', (entry as { id: string }).id);

    if (updateError) {
      console.error('[admin][transfer-logs][update-entry-resolution] update error:', updateError);
      return errorResponse('Erro ao atualizar status.');
    }

    return successResponse({ success: true, new_status: newStatus });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][update-entry-resolution] error:', err);
    return serverErrorResponse(err as Error);
  }
}
