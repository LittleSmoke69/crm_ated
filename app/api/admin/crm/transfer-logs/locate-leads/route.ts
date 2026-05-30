import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getLeadTransferBancaAccess } from '@/lib/server/crm/adminLeadTransferContext';
import { locateLeadsForLog } from '@/lib/server/crm/locateLeadsFromCrm';

const LOG_PREFIX = '[admin][locate-leads]';

/**
 * GET /api/admin/crm/transfer-logs/locate-leads
 *
 * Verifica se os IDs de um pacote estão na carteira CRM da origem e/ou destino (Todos os leads).
 * Query: banca_id, log_id (obrigatórios); lead_ids, session_lead_ids, page, page_size, filter.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const logId = searchParams.get('log_id')?.trim() || null;
    if (!bancaId || !logId) {
      return errorResponse('banca_id e log_id são obrigatórios.', 400);
    }

    const leadIdsParam = searchParams.get('lead_ids')?.trim() || null;
    const sessionLeadIdsParam = searchParams.get('session_lead_ids')?.trim() || null;
    const sessionOnly = searchParams.get('session_only') === '1';

    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('page_size') ?? '100') || 100));
    const filterRaw = (searchParams.get('filter') ?? 'all').toLowerCase();
    const filter =
      filterRaw === 'mismatch' ||
      filterRaw === 'pending' ||
      filterRaw === 'not_in_crm' ||
      filterRaw === 'session_error' ||
      filterRaw === 'needs_correction'
        ? filterRaw
        : 'all';

    const resolved = await getLeadTransferBancaAccess(userId, profile, bancaId);
    if (!resolved?.crmBaseUrl) {
      return errorResponse('Banca não encontrada ou sem permissão.', 403);
    }

    const leadIdsFilter = leadIdsParam
      ? leadIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const sessionIds = sessionLeadIdsParam
      ? sessionLeadIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const sessionErrorLeadIds =
      sessionIds.length > 0 ? new Set(sessionIds) : undefined;

    const data = await locateLeadsForLog({
      bancaId: resolved.bancaId,
      crmBaseUrl: resolved.crmBaseUrl,
      logId,
      leadIdsFilter,
      sessionErrorLeadIds,
      sessionOnly,
      page,
      pageSize,
      filter,
    });

    const { all_items: _all, ...publicData } = data;

    return successResponse({
      ...publicData,
      meta: {
        page,
        page_size: pageSize,
        total_filtered: data.total_filtered,
        filter,
        crm_partial: data.crm_partial,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    if (message.includes('não encontrado')) {
      return errorResponse(message, 404);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
