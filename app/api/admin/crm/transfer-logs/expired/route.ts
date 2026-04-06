/**
 * GET /api/admin/crm/transfer-logs/expired
 *
 * Utiliza apenas a query SQL via RPC get_expired_transfer_stats:
 *   WITH logs_expirados AS (...),
 *        ids_com_pendentes AS (...),
 *        expired_with_pending AS (...)
 *   SELECT total_expired_logs, total_pending_entries, banca_ids, list
 *
 * Parâmetros: banca_id IN (permitidas), opcional source_consultant_email.
 * Requer migration: migrations/add_get_expired_transfer_stats_rpc.sql
 */

import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveLeadTransferQueryBancaIds, gerenteLeadTransferOwnActionsOnly } from '@/lib/server/crm/adminLeadTransferContext';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;

    const scope = await resolveLeadTransferQueryBancaIds(req, userId, profile, bancaId);
    if (scope.error) return errorResponse(scope.error, 403);
    const bancaIds = scope.bancaIds;
    if (!bancaIds.length) {
      return successResponse({ list: [], total_expired_logs: 0, total_pending_entries: 0 });
    }

    const performedByFilter = gerenteLeadTransferOwnActionsOnly(profile) ? userId : null;
    const { data, error } = await supabaseServiceRole.rpc('get_expired_transfer_stats', {
      p_banca_ids: bancaIds,
      p_source_consultant_email: sourceConsultantEmail || null,
      p_performed_by_user_id: performedByFilter,
    });

    if (error) {
      console.error('[admin][transfer-logs][expired] RPC error:', error);
      return successResponse({ list: [], total_expired_logs: 0, total_pending_entries: 0 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return successResponse({ list: [], total_expired_logs: 0, total_pending_entries: 0 });
    }

    const total_expired_logs = Number((row as { total_expired_logs?: unknown }).total_expired_logs) || 0;
    const total_pending_entries = Number((row as { total_pending_entries?: unknown }).total_pending_entries) || 0;
    const listRaw = (row as { list?: unknown }).list;
    let list: unknown[] = [];
    if (Array.isArray(listRaw)) list = listRaw;
    else if (typeof listRaw === 'string') try { list = JSON.parse(listRaw); } catch { /* keep [] */ }

    return successResponse({
      list,
      total_expired_logs,
      total_pending_entries,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][expired] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
