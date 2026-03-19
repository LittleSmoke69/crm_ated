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
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;

    let bancaIds: string[];
    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) {
        return successResponse({ list: [], total_expired_logs: 0, total_pending_entries: 0 });
      }
      bancaIds = allowed;
    }

    const { data, error } = await supabaseServiceRole.rpc('get_expired_transfer_stats', {
      p_banca_ids: bancaIds,
      p_source_consultant_email: sourceConsultantEmail || null,
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
