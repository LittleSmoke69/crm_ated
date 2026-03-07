/**
 * POST /api/admin/crm/transfer-logs/update-transfer-type
 *
 * Atualiza o transfer_type de uma transferência (TF, TF1, TF2, TF3).
 * Body: { log_id, banca_id, transfer_type: 'TF' | 'TF1' | 'TF2' | 'TF3' }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const VALID_TYPES = ['TF', 'TF1', 'TF2', 'TF3'] as const;

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { log_id?: string; banca_id?: string; transfer_type?: string } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const logId = body.log_id?.trim();
    const bancaId = body.banca_id?.trim();
    const transferType = body.transfer_type?.trim();

    if (!logId || !bancaId || !transferType) {
      return errorResponse('log_id, banca_id e transfer_type são obrigatórios.');
    }

    if (!VALID_TYPES.includes(transferType as (typeof VALID_TYPES)[number])) {
      return errorResponse('transfer_type deve ser TF, TF1, TF2 ou TF3.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.');

    const { data: logRow, error: fetchError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, transfer_type')
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId)
      .single();

    if (fetchError || !logRow) {
      return errorResponse('Transferência não encontrada.', 404);
    }

    const { error: updateLogError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .update({ transfer_type: transferType })
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId);

    if (updateLogError) {
      console.error('[admin][transfer-logs][update-transfer-type] update log error:', updateLogError);
      return errorResponse('Erro ao atualizar tipo da transferência.');
    }

    const { error: updateEntriesError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({ transfer_type: transferType })
      .eq('transfer_log_id', logId)
      .eq('banca_id', resolved.bancaId);

    if (updateEntriesError) {
      console.warn('[admin][transfer-logs][update-transfer-type] entries update (optional) failed:', updateEntriesError);
      // Não falha se entries não tiverem a coluna ou outro motivo; o log já foi atualizado.
    }

    return successResponse({
      success: true,
      transfer_type: transferType,
      message: `Tipo da transferência atualizado para ${transferType}.`,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][update-transfer-type] error:', err);
    return serverErrorResponse(err as Error);
  }
}
