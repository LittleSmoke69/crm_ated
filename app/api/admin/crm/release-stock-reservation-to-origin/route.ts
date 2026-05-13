import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdmin } from '@/lib/middleware/permissions';
import { releaseAdminStockReservationToOrigin } from '@/lib/server/crm/releaseAdminStockReservation';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const bodySchema = z
  .object({
    transfer_log_id: z.string().uuid(),
  })
  .strict();

/**
 * POST /api/admin/crm/release-stock-reservation-to-origin
 * Encerra reserva admin→estoque: devolve ao consultor de origem leads em estoque e já repassados (CRM + revertido no Zaploto).
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
      .select('id, banca_id')
      .eq('id', transfer_log_id)
      .maybeSingle();

    if (!log) return errorResponse('Log de transferência não encontrado.', 404);

    const result = await releaseAdminStockReservationToOrigin({
      transferLogId: transfer_log_id,
      bancaId: log.banca_id as string,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status ?? 400);
    }

    const { released, had_repassados, had_em_estoque, crm_repasse_synced, crm_em_estoque_synced, crm_detail } = result;

    let message = `${released} lead(s) devolvido(s) ao consultor de origem no Zaploto (reserva encerrada).`;
    if (had_repassados && crm_repasse_synced) {
      message +=
        ' No CRM, leads já repassados foram movidos do consultor destino do repasse (estoque→consultor) de volta ao consultor de origem.';
    }
    if (had_em_estoque) {
      if (crm_em_estoque_synced) {
        message +=
          ' No CRM, leads em estoque ou já revertidos no Zaploto foram tratados para o consultor de origem (repasse estoque→consultor ou pool).';
      } else {
        message +=
          ' Leads em estoque: sem URL de CRM ou sem movimentação confirmada no CRM (ex.: apenas atualização no Zaploto). Leads já revertidos exigem CRM para realinhar titular.';
      }
    }
    if (crm_detail) {
      message += ` ${crm_detail}`;
    }

    console.log(
      `[admin][release-stock-reservation-to-origin] user=${userId} log=${transfer_log_id} released=${released} repasse=${crm_repasse_synced} em_estoque_crm=${crm_em_estoque_synced}`
    );

    return successResponse(
      {
        released,
        transfer_log_id,
        had_repassados,
        had_em_estoque,
        crm_repasse_synced,
        crm_em_estoque_synced,
        crm_detail,
      },
      message
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
