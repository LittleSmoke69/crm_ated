/**
 * GET /api/admin/crm/transfer-logs/resolved-stats
 *
 * Estatísticas de transferências já resolvidas no banco (com leads disponíveis para mover).
 * Query: banca_id?, from?, to? (mesmo período dos filtros do Histórico).
 * Retorno: total_resolved_logs, total_disponivel, by_type: { TF, TF1, TF2, TF3 }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));

    let bancaIds: string[];
    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
      bancaIds = allowed;
    }

    let q = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days, transfer_type')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: false });

    if (fromParam) q = q.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    if (toParam) q = q.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));

    const { data: logs, error: logsError } = await q;

    if (logsError || !logs?.length) {
      return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
    }

    type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null; transfer_type?: string | null };
    const expiredLogs = (logs as LogRow[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );

    if (expiredLogs.length === 0) {
      return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
    }

    const logIds = expiredLogs.map((l) => l.id);
    const { data: entries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, resolution_status')
      .in('transfer_log_id', logIds);

    const pendingByLogId = new Map<string, boolean>();
    const disponivelByLogId = new Map<string, number>();
    const vinculadoByLogId = new Map<string, number>();
    (entries ?? []).forEach((e: { transfer_log_id: string; resolution_status?: string | null }) => {
      const logId = e.transfer_log_id;
      if (e.resolution_status === 'pending') pendingByLogId.set(logId, true);
      if (e.resolution_status === 'disponivel_retransferencia') {
        disponivelByLogId.set(logId, (disponivelByLogId.get(logId) ?? 0) + 1);
      }
      if (e.resolution_status === 'vinculado') {
        vinculadoByLogId.set(logId, (vinculadoByLogId.get(logId) ?? 0) + 1);
      }
    });

    const byType: Record<string, number> = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };
    let total_resolved_logs = 0;
    let total_disponivel = 0;
    let total_vinculado = 0;

    for (const log of expiredLogs) {
      if (pendingByLogId.has(log.id)) continue;
      const disp = disponivelByLogId.get(log.id) ?? 0;
      const vinc = vinculadoByLogId.get(log.id) ?? 0;
      total_vinculado += vinc;
      if (disp > 0) {
        total_resolved_logs += 1;
        total_disponivel += disp;
        const t = (log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(log.transfer_type))) ? String(log.transfer_type) : 'TF';
        byType[t] = (byType[t] ?? 0) + disp;
      }
    }

    return successResponse({ total_resolved_logs, total_disponivel, total_vinculado, by_type: byType });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolved-stats] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
