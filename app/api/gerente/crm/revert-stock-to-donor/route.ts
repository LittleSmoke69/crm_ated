import { NextRequest } from 'next/server';
import { isLeadStockAdminViewer, requireLeadStockViewer } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { markStockEntriesRevertedToDonor } from '@/lib/server/crm/gerenteStockReservation';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const bodySchema = z
  .object({
    banca_id: z.string().uuid(),
    transfer_log_id: z.string().uuid(),
    /** Obrigatório para admin/super_admin (dono do estoque). Gerente usa o próprio id. */
    gerente_user_id: z.string().uuid().optional(),
    lead_ids: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .strict();

const LOG_PREFIX = '[gerente][revert-stock-to-donor]';

/**
 * POST /api/gerente/crm/revert-stock-to-donor
 * Reverte reservas ainda em_estoque: marca como revertido ao consultor doador.
 * Não chama o CRM — neste fluxo o lead permanece com o consultor de origem até o gerente repassar.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadStockViewer(req);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.', 400);
    }

    const { banca_id, transfer_log_id, lead_ids } = parsed.data;
    const admin = isLeadStockAdminViewer(profile);

    let effectiveGerenteId: string;
    if (admin) {
      const gid = (parsed.data.gerente_user_id ?? '').trim();
      if (!gid) {
        return errorResponse('Para admin/super_admin, informe gerente_user_id (dono do estoque do pacote).', 400);
      }
      const resolved = await getAdminBancaId(userId, profile, banca_id, { skipLeadTransferLock: true });
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 404);
      const ok = await assertGerenteHasBanca(gid, banca_id);
      if (!ok) return errorResponse('Gerente não pertence a esta banca.', 403);
      effectiveGerenteId = gid;
    } else {
      const has = await assertGerenteHasBanca(userId, banca_id);
      if (!has) return errorResponse('Banca não disponível.', 403);
      if (parsed.data.gerente_user_id && parsed.data.gerente_user_id !== userId) {
        return errorResponse('Sem permissão para reverter o estoque de outro gerente.', 403);
      }
      effectiveGerenteId = userId;
    }

    const { data: logRow } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, transfer_kind, banca_id')
      .eq('id', transfer_log_id)
      .eq('banca_id', banca_id)
      .maybeSingle();

    if (!logRow || (logRow as { transfer_kind?: string }).transfer_kind !== 'admin_to_gerente_stock') {
      return errorResponse('Pacote inválido ou não é reserva admin → estoque.', 400);
    }

    const result = await markStockEntriesRevertedToDonor({
      transferLogId: transfer_log_id,
      bancaId: banca_id,
      gerenteUserId: effectiveGerenteId,
      leadIds: lead_ids?.length ? lead_ids.map((x) => String(x).trim()) : undefined,
    });

    if ('error' in result) {
      console.error(`${LOG_PREFIX}`, result.error);
      return errorResponse('Erro ao reverter reservas.', 500);
    }

    console.log(
      `${LOG_PREFIX} user=${userId} admin=${admin} gerente=${effectiveGerenteId} log=${transfer_log_id} reverted=${result.reverted}`
    );

    return successResponse(
      {
        reverted: result.reverted,
        transfer_log_id,
        banca_id,
        gerente_user_id: effectiveGerenteId,
      },
      result.reverted === 0
        ? 'Nenhum lead em estoque para reverter (já repassado, cancelado ou revertido).'
        : `${result.reverted} lead(s) marcado(s) como revertido ao consultor doador.`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
