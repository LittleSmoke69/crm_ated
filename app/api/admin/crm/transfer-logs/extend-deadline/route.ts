/**
 * POST /api/admin/crm/transfer-logs/extend-deadline
 *
 * Renova o prazo de validade de uma transferência (opcional pelo usuário).
 * Aumenta deadline_days do log para que a transferência tenha mais X dias a partir de hoje.
 *
 * Body: log_id (obrigatório), banca_id (obrigatório), extra_days (opcional, default 10).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const LOG_PREFIX = '[admin][transfer-logs][extend-deadline]';

const DEFAULT_EXTRA_DAYS = 10;
const MAX_EXTRA_DAYS = 365;

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let logId: string | null = null;
    let bancaId: string | null = null;
    let extraDays = DEFAULT_EXTRA_DAYS;

    if (req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      try {
        const body = await req.json();
        const b = body as { log_id?: string; banca_id?: string; extra_days?: number };
        logId = b?.log_id?.trim() || null;
        bancaId = b?.banca_id?.trim() || null;
        if (b?.extra_days != null) {
          const n = Number(b.extra_days);
          extraDays = Number.isFinite(n) && n >= 1 ? Math.min(MAX_EXTRA_DAYS, Math.round(n)) : DEFAULT_EXTRA_DAYS;
        }
      } catch {
        // ignore
      }
    }

    if (!logId || !bancaId) {
      return errorResponse('log_id e banca_id são obrigatórios.', 400);
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.', 403);
    }

    const { data: logRow, error: fetchError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, created_at, deadline_days')
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId)
      .single();

    if (fetchError || !logRow) {
      return errorResponse('Transferência não encontrada.', 404);
    }

    const createdAt = (logRow as { created_at?: string }).created_at;
    if (!createdAt) {
      return errorResponse('Data da transferência inválida.', 400);
    }

    const transferredAt = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - transferredAt.getTime();
    const daysSinceCreated = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const newDeadlineDays = daysSinceCreated + extraDays;

    const { error: updateError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .update({ deadline_days: newDeadlineDays })
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId);

    if (updateError) {
      console.error(`${LOG_PREFIX} UPDATE error:`, updateError);
      return errorResponse('Erro ao atualizar prazo da transferência.');
    }

    return successResponse({
      deadline_days: newDeadlineDays,
      days_left: extraDays,
      message: `Prazo renovado: ${extraDays} dia(s) a partir de hoje.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
