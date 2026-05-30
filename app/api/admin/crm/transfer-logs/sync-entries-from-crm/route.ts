import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getLeadTransferBancaAccess } from '@/lib/server/crm/adminLeadTransferContext';
import { syncEntriesFromCrmLocate } from '@/lib/server/crm/locateLeadsFromCrm';

const LOG_PREFIX = '[admin][sync-entries-from-crm]';

/**
 * POST /api/admin/crm/transfer-logs/sync-entries-from-crm
 *
 * Corrige entries no banco conforme titular no CRM — sem repasse.
 * Body: { banca_id, log_id, lead_ids?, session_lead_ids?, dry_run? }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);

    let body: {
      banca_id?: string;
      log_id?: string;
      lead_ids?: string[];
      session_lead_ids?: string[];
      dry_run?: boolean;
    } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const bancaId = body.banca_id?.trim() || null;
    const logId = body.log_id?.trim() || null;
    if (!bancaId || !logId) {
      return errorResponse('banca_id e log_id são obrigatórios.', 400);
    }

    const resolved = await getLeadTransferBancaAccess(userId, profile, bancaId);
    if (!resolved?.crmBaseUrl) {
      return errorResponse('Banca não encontrada ou sem permissão.', 403);
    }

    const leadIds = Array.isArray(body.lead_ids)
      ? body.lead_ids.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const sessionIds = Array.isArray(body.session_lead_ids)
      ? body.session_lead_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const sessionErrorLeadIds = sessionIds.length > 0 ? new Set(sessionIds) : undefined;

    const result = await syncEntriesFromCrmLocate({
      bancaId: resolved.bancaId,
      crmBaseUrl: resolved.crmBaseUrl,
      logId,
      leadIds,
      sessionErrorLeadIds,
      dryRun: body.dry_run === true,
    });

    console.log(
      `${LOG_PREFIX} log=${logId} corrected=${result.corrected} ok=${result.unchanged_ok} manual=${result.manual_review.length} dry=${body.dry_run === true}`
    );

    return successResponse(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    if (message.includes('não encontrado')) {
      return errorResponse(message, 404);
    }
    console.error(`${LOG_PREFIX} POST error:`, err);
    return serverErrorResponse(err);
  }
}
