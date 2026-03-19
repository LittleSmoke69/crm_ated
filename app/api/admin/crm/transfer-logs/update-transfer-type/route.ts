/**
 * POST /api/admin/crm/transfer-logs/update-transfer-type
 *
 * Atualiza o transfer_type de uma transferência (TF, TF1, TF2, TF3).
 * Opcional: deadline_days_from_now — redefine o prazo em dias a partir de hoje (o timer dos leads reseta).
 * Body: { log_id, banca_id, transfer_type, deadline_days_from_now?: number }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const VALID_TYPES = ['TF', 'TF1', 'TF2', 'TF3'] as const;
const MIN_DEADLINE_DAYS = 1;
const MAX_DEADLINE_DAYS = 365;

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { log_id?: string; banca_id?: string; transfer_type?: string; deadline_days_from_now?: number } = {};
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
    const deadlineDaysFromNow = body.deadline_days_from_now;

    if (!logId || !bancaId || !transferType) {
      return errorResponse('log_id, banca_id e transfer_type são obrigatórios.');
    }

    if (!VALID_TYPES.includes(transferType as (typeof VALID_TYPES)[number])) {
      return errorResponse('transfer_type deve ser TF, TF1, TF2 ou TF3.');
    }

    if (deadlineDaysFromNow != null) {
      const n = Number(deadlineDaysFromNow);
      if (!Number.isFinite(n) || n < MIN_DEADLINE_DAYS || n > MAX_DEADLINE_DAYS) {
        return errorResponse(`deadline_days_from_now deve ser entre ${MIN_DEADLINE_DAYS} e ${MAX_DEADLINE_DAYS}.`);
      }
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.');

    const { data: logRow, error: fetchError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, transfer_type, created_at')
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId)
      .single();

    if (fetchError || !logRow) {
      return errorResponse('Transferência não encontrada.', 404);
    }

    const updatePayload: { transfer_type: string; deadline_days?: number } = { transfer_type: transferType };
    if (deadlineDaysFromNow != null && Number(deadlineDaysFromNow) >= MIN_DEADLINE_DAYS) {
      const createdAt = (logRow as { created_at?: string }).created_at;
      if (createdAt) {
        const transferredAt = new Date(createdAt);
        const now = new Date();
        const diffMs = now.getTime() - transferredAt.getTime();
        const daysSinceCreated = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const newDeadlineDays = daysSinceCreated + Math.round(Number(deadlineDaysFromNow));
        updatePayload.deadline_days = newDeadlineDays;
      }
    }

    const { error: updateLogError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .update(updatePayload)
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
      deadline_days: updatePayload.deadline_days ?? undefined,
      message: updatePayload.deadline_days != null
        ? `Tipo atualizado para ${transferType}. Prazo redefinido: timer dos leads resetado.`
        : `Tipo da transferência atualizado para ${transferType}.`,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][update-transfer-type] error:', err);
    return serverErrorResponse(err as Error);
  }
}
