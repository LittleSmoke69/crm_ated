/**
 * POST /api/admin/crm/transfer-logs/revert-resolved-to-pending
 *
 * Reverte em massa todas as entries já resolvidas (vinculado ou disponivel_retransferencia)
 * para status "pending". Aplica a todas as solicitações de transferência (sem filtro de período).
 * Os logs passam a ser considerados "expirados" (com pendentes) na listagem.
 * Body: { banca_id?: string } — se omitido, aplica em todas as bancas permitidas ao admin.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { banca_id?: string } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const bancaIdParam = body.banca_id?.trim() || null;

    let bancaIds: string[];
    if (bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse({ count: 0, message: 'Nenhuma banca permitida.' });
      bancaIds = allowed;
    }

    const { data: updated, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({
        resolution_status: 'pending',
        resolved_at: null,
        current_total_depositado_at_resolution: null,
        current_total_apostado_at_resolution: null,
      })
      .in('banca_id', bancaIds)
      .in('resolution_status', ['vinculado', 'disponivel_retransferencia'])
      .select('id');

    if (error) {
      console.error('[admin][transfer-logs][revert-resolved-to-pending] update error:', error);
      return errorResponse('Erro ao reverter status.');
    }

    const count = Array.isArray(updated) ? updated.length : 0;
    return successResponse({
      count,
      message: count === 0
        ? 'Nenhuma entry resolvida encontrada para reverter.'
        : `${count} lead(s) revertido(s) para pendente. Serão analisados novamente ao resolver transferências expiradas.`,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][revert-resolved-to-pending] error:', err);
    return serverErrorResponse(err as Error);
  }
}
