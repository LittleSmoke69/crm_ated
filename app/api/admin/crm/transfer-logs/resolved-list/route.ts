/**
 * GET /api/admin/crm/transfer-logs/resolved-list
 *
 * Lista transferências já resolvidas no banco com leads disponíveis para mover (sem filtro de período).
 * Query: banca_id? (opcional). Retorna todas as transferências resolvidas das bancas permitidas.
 * Retorno: Array<{ log_id, banca_id, transfer_type, disponivel, source_consultant_email, target_consultant_email }>
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    let bancaIds: string[];
    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse([]);
      bancaIds = allowed;
    }

    const { data: logs, error: logsError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days, transfer_type, source_consultant_email, target_consultant_email')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: false });

    if (logsError || !logs?.length) return successResponse([]);

    type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null; transfer_type?: string | null; source_consultant_email?: string | null; target_consultant_email?: string | null };
    const expiredLogs = (logs as LogRow[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );

    if (expiredLogs.length === 0) return successResponse([]);

    const logIds = expiredLogs.map((l) => l.id);
    const { data: entries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, resolution_status')
      .in('transfer_log_id', logIds);

    const pendingByLogId = new Map<string, boolean>();
    const disponivelByLogId = new Map<string, number>();
    (entries ?? []).forEach((e: { transfer_log_id: string; resolution_status?: string | null }) => {
      const logId = e.transfer_log_id;
      if (e.resolution_status === 'pending') pendingByLogId.set(logId, true);
      if (e.resolution_status === 'disponivel_retransferencia') {
        disponivelByLogId.set(logId, (disponivelByLogId.get(logId) ?? 0) + 1);
      }
    });

    const list = expiredLogs
      .filter((log) => !pendingByLogId.has(log.id) && (disponivelByLogId.get(log.id) ?? 0) > 0)
      .map((log) => ({
        log_id: log.id,
        banca_id: log.banca_id,
        transfer_type: (log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(log.transfer_type))) ? String(log.transfer_type) : 'TF',
        disponivel: disponivelByLogId.get(log.id) ?? 0,
        source_consultant_email: (log.source_consultant_email ?? '').trim(),
        target_consultant_email: (log.target_consultant_email ?? '').trim(),
      }));

    return successResponse(list);
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolved-list] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
