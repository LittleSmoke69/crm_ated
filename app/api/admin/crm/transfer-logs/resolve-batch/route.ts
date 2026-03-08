/**
 * POST /api/admin/crm/transfer-logs/resolve-batch
 *
 * Resolve em lote transferências expiradas.
 * Body: { banca_id?: string, log_ids?: string[] }
 * - Se log_ids for informado: resolve apenas esses logs (devem estar expirados e na banca permitida).
 * - Se apenas banca_id: resolve todas as expiradas dessa banca com entries pendentes.
 * - Se nenhum: resolve todas as expiradas das bancas permitidas ao usuário.
 *
 * Retorno: { results: Array<{ log_id, banca_id, ... }>, total_resolved, total_vinculado, total_disponivel }
 * maxDuration: 300s — cada log chama CRM externo + updates; muitos logs podem demorar.
 */
export const maxDuration = 300;

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { resolveOneTransferLog, isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { banca_id?: string; log_ids?: string[] } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const bancaId = body.banca_id?.trim() || null;
    const logIdsParam = body.log_ids;

    let bancaIds: string[];
    const contextByBancaId = new Map<string, { bancaId: string; crmBaseUrl: string | null }>();

    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
      contextByBancaId.set(resolved.bancaId, { bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl });
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0 });
      bancaIds = allowed;
      for (const bid of bancaIds) {
        const resolved = await getAdminBancaId(userId, profile, bid);
        if (resolved) contextByBancaId.set(bid, { bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl });
      }
    }

    type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null; transfer_type?: string | null };
    let logsToResolve: LogRow[] = [];

    if (Array.isArray(logIdsParam) && logIdsParam.length > 0) {
      const ids = logIdsParam.map((id) => String(id).trim()).filter(Boolean);
      if (ids.length === 0) return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0 });

      const { data: logs, error } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, banca_id, created_at, deadline_days, transfer_type')
        .in('id', ids)
        .in('banca_id', bancaIds);

      if (error || !logs?.length) return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0 });

      logsToResolve = (logs as LogRow[]).filter((log) =>
        isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
      );
    } else {
      const { data: logs, error } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, banca_id, created_at, deadline_days, transfer_type')
        .in('banca_id', bancaIds)
        .order('created_at', { ascending: false });

      if (error || !logs?.length) return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0 });

      const expired = (logs as LogRow[]).filter((log) =>
        isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
      );

      const expiredIds = expired.map((l) => l.id);
      const { data: pending } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('transfer_log_id')
        .in('transfer_log_id', expiredIds)
        .eq('resolution_status', 'pending');

      const hasPending = new Set<string>();
      (pending ?? []).forEach((r: { transfer_log_id: string }) => hasPending.add(r.transfer_log_id));
      logsToResolve = expired.filter((log) => hasPending.has(log.id));
    }

    const results: Array<{
      log_id: string;
      banca_id: string;
      transfer_type: string;
      resolved: number;
      vinculado: number;
      disponivel_retransferencia: number;
      message: string;
    }> = [];
    let total_resolved = 0;
    let total_vinculado = 0;
    let total_disponivel = 0;

    for (const log of logsToResolve) {
      const ctx = contextByBancaId.get(log.banca_id);
      if (!ctx) continue;
      const result = await resolveOneTransferLog(ctx, log.id);
      results.push({
        log_id: log.id,
        banca_id: log.banca_id,
        transfer_type: (log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(log.transfer_type))) ? String(log.transfer_type) : 'TF',
        resolved: result.resolved,
        vinculado: result.vinculado,
        disponivel_retransferencia: result.disponivel_retransferencia,
        message: result.message,
      });
      total_resolved += result.resolved;
      total_vinculado += result.vinculado;
      total_disponivel += result.disponivel_retransferencia;
    }

    return successResponse({
      results,
      total_resolved,
      total_vinculado,
      total_disponivel,
      message: `Resolvidas ${results.length} transferência(s): ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.`,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolve-batch] error:', err);
    return serverErrorResponse(err as Error);
  }
}
