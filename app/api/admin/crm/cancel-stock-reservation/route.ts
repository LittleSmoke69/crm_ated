import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { markStockEntriesCanceled } from '@/lib/server/crm/gerenteStockReservation';
import { z } from 'zod';

const bodySchema = z
  .object({
    transfer_log_id: z.string().uuid(),
  })
  .strict();

/**
 * POST /api/admin/crm/cancel-stock-reservation
 * Cancela todas as entries ainda em estoque de um log admin→estoque (transfer_kind='admin_to_gerente_stock').
 * Marca stock_status='cancelado' (não chama o CRM — a reserva é lógica).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.', 400);
    }

    const { transfer_log_id } = parsed.data;

    const { data: log } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, transfer_kind')
      .eq('id', transfer_log_id)
      .maybeSingle();

    if (!log) return errorResponse('Log de transferência não encontrado.', 404);
    if ((log as { transfer_kind?: string }).transfer_kind !== 'admin_to_gerente_stock') {
      return errorResponse('Apenas reservas admin→estoque podem ser canceladas.', 400);
    }

    const result = await markStockEntriesCanceled(transfer_log_id, log.banca_id as string);
    if ('error' in result) {
      console.error('[admin][cancel-stock-reservation] erro:', result.error);
      return errorResponse('Erro ao cancelar reserva.', 500);
    }

    console.log(
      `[admin][cancel-stock-reservation] user=${userId} log=${transfer_log_id} canceladas=${result.canceled}`
    );

    return successResponse(
      { canceled: result.canceled, transfer_log_id },
      result.canceled === 0
        ? 'Nenhum lead em estoque para cancelar neste pacote (já foi repassado ou cancelado).'
        : `${result.canceled} lead(s) cancelado(s) do estoque.`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
