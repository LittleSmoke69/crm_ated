import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdmin } from '@/lib/middleware/permissions';
import { syncStockReservationAsDirectCrmTransfer } from '@/lib/server/crm/syncStockReservationAsDirectCrm';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const bodySchema = z
  .object({
    transfer_log_id: z.string().uuid(),
    /** Opcional se o pacote tiver `stock_crm_target_consultant_email` no filters_snapshot (reserva). */
    target_consultant_email: z.string().trim().min(3).email().optional(),
  })
  .strict();

/**
 * POST /api/admin/crm/sync-stock-reservation-as-direct-crm
 * Retira leads do estoque do gerente no Zaploto e repassa no CRM (origem → consultor destino).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.', 400);
    }

    const { transfer_log_id, target_consultant_email } = parsed.data;

    const { data: log } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id')
      .eq('id', transfer_log_id)
      .maybeSingle();

    if (!log) return errorResponse('Log de transferência não encontrado.', 404);

    const result = await syncStockReservationAsDirectCrmTransfer({
      transferLogId: transfer_log_id,
      bancaId: log.banca_id as string,
      ...(target_consultant_email?.trim() ? { targetConsultantEmail: target_consultant_email.trim().toLowerCase() } : {}),
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status ?? 400);
    }

    const destUsed = result.destination_consultant_email;

    const msg = `${result.entries_updated} lead(s): retirados do estoque do gerente e enviados no CRM para ${destUsed} (origem → destino).${result.skipped_already_at_target > 0 ? ` ${result.skipped_already_at_target} já estavam com o destino no CRM.` : ''}`;

    console.log(
      `[admin][sync-stock-reservation-as-direct-crm] user=${userId} log=${transfer_log_id} crm_count=${result.crm_count} updated=${result.entries_updated} skipped=${result.skipped_already_at_target} dest=${destUsed}`
    );

    return successResponse(
      {
        transfer_log_id,
        crm_count: result.crm_count,
        entries_updated: result.entries_updated,
        skipped_already_at_target: result.skipped_already_at_target,
        destination_consultant_email: destUsed,
      },
      msg
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
