import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[admin/crm/lead-requests/reconcile]';

/**
 * POST /api/admin/crm/lead-requests/reconcile
 * Reconcilia solicitações pendentes/parciais que têm transferências reais em admin_lead_transfer_logs
 * (via filters_snapshot->>'from_solicitation' = id), mas cujo status não foi atualizado.
 * Atualiza status para 'approved' ou 'partial' conforme a contagem real de leads transferidos.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    // 1. Buscar todas as solicitações pending/partial
    const { data: pendingRows, error: fetchError } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, consultores, banca_id, status, approval_snapshot')
      .in('status', ['pending', 'partial']);

    if (fetchError) {
      console.error(`${LOG_PREFIX} fetch error:`, fetchError);
      return errorResponse('Erro ao buscar solicitações.', 500);
    }

    const rows = pendingRows ?? [];
    if (rows.length === 0) return successResponse({ reconciled: 0 }, 'Nenhuma solicitação pendente encontrada.');

    const pendingIds = rows.map((r: { id: string }) => r.id);

    // 2. Buscar logs de transferência vinculados a estas solicitações
    const { data: allLogs, error: logsError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, filters_snapshot, count')
      .in('banca_id', [...new Set(rows.map((r: { banca_id: string | null }) => r.banca_id).filter(Boolean))] as string[])
      .not('filters_snapshot', 'is', null);

    if (logsError) {
      console.error(`${LOG_PREFIX} logs fetch error:`, logsError);
      return errorResponse('Erro ao buscar logs de transferência.', 500);
    }

    // Agrupar logs por from_solicitation
    const logsByRequestId = new Map<string, string[]>();
    for (const log of allLogs ?? []) {
      const fs = log.filters_snapshot as Record<string, unknown> | null;
      const solicitacaoId = typeof fs?.from_solicitation === 'string' ? fs.from_solicitation.trim() : null;
      if (!solicitacaoId || !pendingIds.includes(solicitacaoId)) continue;
      if (!logsByRequestId.has(solicitacaoId)) logsByRequestId.set(solicitacaoId, []);
      logsByRequestId.get(solicitacaoId)!.push(log.id);
    }

    if (logsByRequestId.size === 0) {
      return successResponse({ reconciled: 0 }, 'Nenhuma solicitação com transferências vinculadas encontrada.');
    }

    // 3. Para cada solicitação com logs, contar entries reais (não devolvido/reversed)
    const allLinkedLogIds = [...new Set([...logsByRequestId.values()].flat())];
    const { data: entries, error: entriesError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, resolution_status')
      .in('transfer_log_id', allLinkedLogIds);

    if (entriesError) {
      console.error(`${LOG_PREFIX} entries fetch error:`, entriesError);
      return errorResponse('Erro ao buscar entradas de transferência.', 500);
    }

    // Contar leads válidos por log
    const validCountByLogId = new Map<string, number>();
    for (const entry of entries ?? []) {
      const rs = entry.resolution_status as string | null;
      if (rs === 'devolvido' || rs === 'reversed') continue;
      validCountByLogId.set(entry.transfer_log_id, (validCountByLogId.get(entry.transfer_log_id) ?? 0) + 1);
    }

    let reconciledCount = 0;
    const updates: { id: string; newStatus: string; actualCount: number }[] = [];

    for (const row of rows) {
      const logIds = logsByRequestId.get(row.id);
      if (!logIds || logIds.length === 0) continue;

      const actualCount = logIds.reduce((sum, logId) => sum + (validCountByLogId.get(logId) ?? 0), 0);
      if (actualCount === 0) continue;

      const totalRequested = ((row.consultores as { quantity: number }[]) ?? [])
        .reduce((s: number, c: { quantity: number }) => s + (c.quantity ?? 0), 0);
      if (totalRequested === 0) continue;

      const newStatus = actualCount >= totalRequested ? 'approved' : 'partial';
      if (newStatus === row.status) continue;

      updates.push({ id: row.id, newStatus, actualCount });
    }

    // 4. Aplicar updates
    for (const upd of updates) {
      const row = rows.find((r: { id: string }) => r.id === upd.id);
      const existingSnap = (row?.approval_snapshot as Record<string, unknown> | null) ?? {};
      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update({
          status: upd.newStatus,
          approval_snapshot: { ...existingSnap, total_leads_transferred: upd.actualCount },
        })
        .eq('id', upd.id);

      if (updateError) {
        console.error(`${LOG_PREFIX} update error for ${upd.id}:`, updateError);
      } else {
        reconciledCount++;
        console.log(`${LOG_PREFIX} reconciled ${upd.id} → ${upd.newStatus} (${upd.actualCount} leads)`);
      }
    }

    return successResponse(
      { reconciled: reconciledCount, checked: rows.length },
      reconciledCount > 0
        ? `${reconciledCount} solicitação(ões) reconciliada(s) com sucesso.`
        : 'Nenhuma solicitação precisou ser reconciliada.'
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) return errorResponse(msg, 403);
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
