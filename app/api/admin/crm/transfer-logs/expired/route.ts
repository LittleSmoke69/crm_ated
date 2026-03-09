/**
 * GET /api/admin/crm/transfer-logs/expired
 *
 * Lista transferências expiradas (prazo decorrido) que ainda têm entries com resolution_status = 'pending'.
 * Query: banca_id? (opcional). Retorna logs com id, banca_id, created_at, deadline_days, source/target, count e to_resolve (qtd de entries pendentes).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

const DEFAULT_DEADLINE_DAYS = 10;
const IN_BATCH_SIZE = 150;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isTransferExpired(createdAt: string | null | undefined, deadlineDays?: number | null): boolean {
  if (!createdAt) return true;
  const days = deadlineDays != null && deadlineDays >= 1 ? deadlineDays : DEFAULT_DEADLINE_DAYS;
  const transferredAt = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - transferredAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= days;
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;

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
      .select('id, banca_id, created_at, deadline_days, source_consultant_email, target_consultant_email, count, transfer_type')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: false });

    if (logsError || !logs?.length) return successResponse([]);

    const expiredLogs = (logs as { id: string; banca_id: string; created_at: string; deadline_days?: number | null; source_consultant_email?: string; target_consultant_email?: string; count?: number; transfer_type?: string }[])
      .filter((log) => isTransferExpired(log.created_at, log.deadline_days));

    if (expiredLogs.length === 0) return successResponse([]);

    const logIds = expiredLogs.map((l) => l.id);
    type PendingRow = { transfer_log_id: string };
    const allPending: PendingRow[] = [];
    for (const chunk of chunkArray(logIds, IN_BATCH_SIZE)) {
      const { data } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('transfer_log_id')
        .in('transfer_log_id', chunk)
        .eq('resolution_status', 'pending');
      if (Array.isArray(data)) allPending.push(...(data as PendingRow[]));
    }

    const pendingByLogId = new Map<string, number>();
    allPending.forEach((r: PendingRow) => {
      pendingByLogId.set(r.transfer_log_id, (pendingByLogId.get(r.transfer_log_id) ?? 0) + 1);
    });

    const list = expiredLogs
      .filter((log) => (pendingByLogId.get(log.id) ?? 0) > 0)
      .map((log) => ({
        id: log.id,
        banca_id: log.banca_id,
        created_at: log.created_at,
        deadline_days: log.deadline_days ?? DEFAULT_DEADLINE_DAYS,
        source_consultant_email: log.source_consultant_email ?? '',
        target_consultant_email: log.target_consultant_email ?? '',
        count: log.count ?? 0,
        transfer_type: log.transfer_type ?? 'TF',
        to_resolve: pendingByLogId.get(log.id) ?? 0,
      }));

    return successResponse(list);
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][expired] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
