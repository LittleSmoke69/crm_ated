import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdmin } from '@/lib/middleware/permissions';
import { reverseGerenteStockRepassToDonor } from '@/lib/server/crm/reverseGerenteStockRepass';
import { z } from 'zod';

const bodySchema = z
  .object({
    transfer_log_id: z.string().uuid(),
    banca_id: z.string().uuid(),
  })
  .strict();

/**
 * POST /api/admin/crm/reverse-gerente-stock-repass
 * Reverte repasse gerente (estoque → consultor): CRM devolve ao consultor doador e repassado volta a em_estoque.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.', 400);
    }

    const { transfer_log_id, banca_id } = parsed.data;

    const result = await reverseGerenteStockRepassToDonor({
      transferLogId: transfer_log_id,
      bancaId: banca_id,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status ?? 400);
    }

    console.log(
      `[admin][reverse-gerente-stock-repass] user=${userId} log=${transfer_log_id} crm=${result.crm_count} stock=${result.stock_updated}`
    );

    return successResponse(
      {
        transfer_log_id,
        banca_id,
        crm_count: result.crm_count,
        stock_updated: result.stock_updated,
      },
      `Repasse revertido: ${result.crm_count} lead(s) devolvido(s) ao consultor doador no CRM; ${result.stock_updated} linha(s) voltaram ao estoque do gerente.`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
