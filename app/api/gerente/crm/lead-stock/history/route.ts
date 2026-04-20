import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/gerente/crm/lead-stock/history?banca_id=
 *
 * Retorna o histórico do estoque do gerente numa banca:
 *  - Reservas recebidas (admin_to_gerente_stock) direcionadas a este gerente.
 *  - Repasses feitos (gerente_stock_to_consultant) executados por este gerente.
 *
 * Ordenação: created_at desc. Cada item é enriquecido com nome de quem executou,
 * contagens de estoque e totais quando relevantes.
 */

type LogRow = {
  id: string;
  banca_id: string | null;
  created_at: string | null;
  transfer_type: string | null;
  deadline_days: number | null;
  transfer_kind: string | null;
  performed_by_user_id: string | null;
  source_consultant_email: string | null;
  target_consultant_email: string | null;
  count: number | null;
  total_balance_snapshot: number | null;
};

type EntryRow = {
  transfer_log_id: string;
  stock_status: string | null;
  saldo_snapshot: number | null;
};

type HistoryItem = {
  id: string;
  created_at: string | null;
  kind: 'reserved' | 'distributed';
  transfer_kind: 'admin_to_gerente_stock' | 'gerente_stock_to_consultant';
  transfer_type: string;
  deadline_days: number;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  source_consultant_email: string | null;
  source_consultant_name: string | null;
  target_consultant_email: string | null;
  target_consultant_name: string | null;
  count: number;
  total_balance: number;
  stock_total: number;
  stock_pending: number;
  stock_distributed: number;
  stock_canceled: number;
  status_label: 'em_estoque' | 'repassado' | 'cancelado_total' | 'cancelado_parcial' | 'distribuido';
};

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);

    // 1) Reservas recebidas: entries onde stock_gerente_user_id = userId
    const { data: reservedEntries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, stock_status, saldo_snapshot')
      .eq('banca_id', bancaId)
      .eq('stock_gerente_user_id', userId);

    const reservedEntriesList = (Array.isArray(reservedEntries) ? reservedEntries : []) as EntryRow[];
    const reservedLogIds = Array.from(new Set(reservedEntriesList.map((e) => e.transfer_log_id).filter(Boolean)));

    const { data: reservedLogs } = reservedLogIds.length
      ? await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .select(
            'id, banca_id, created_at, transfer_type, deadline_days, transfer_kind, performed_by_user_id, source_consultant_email, target_consultant_email, count, total_balance_snapshot'
          )
          .in('id', reservedLogIds)
          .eq('banca_id', bancaId)
          .eq('transfer_kind', 'admin_to_gerente_stock')
      : { data: [] as LogRow[] };

    const reservedLogsList = (Array.isArray(reservedLogs) ? reservedLogs : []) as LogRow[];

    // 2) Repasses executados pelo próprio gerente
    const { data: distributedLogs } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select(
        'id, banca_id, created_at, transfer_type, deadline_days, transfer_kind, performed_by_user_id, source_consultant_email, target_consultant_email, count, total_balance_snapshot'
      )
      .eq('banca_id', bancaId)
      .eq('transfer_kind', 'gerente_stock_to_consultant')
      .eq('performed_by_user_id', userId);

    const distributedLogsList = (Array.isArray(distributedLogs) ? distributedLogs : []) as LogRow[];

    // 3) Agrega contagem por log (para os logs reservados, já temos nas entries acima;
    //    para os logs de repasse, buscamos do total que está em `count`).
    const stockByLogId = new Map<string, { total: number; em_estoque: number; repassado: number; cancelado: number; balance: number }>();
    for (const e of reservedEntriesList) {
      const cur = stockByLogId.get(e.transfer_log_id) ?? { total: 0, em_estoque: 0, repassado: 0, cancelado: 0, balance: 0 };
      cur.total += 1;
      if (e.stock_status === 'em_estoque') cur.em_estoque += 1;
      else if (e.stock_status === 'repassado') cur.repassado += 1;
      else if (e.stock_status === 'cancelado') cur.cancelado += 1;
      cur.balance += e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0;
      stockByLogId.set(e.transfer_log_id, cur);
    }

    // 4) Coleta nomes (performed_by) e nomes de consultores (source/target)
    const allLogs = [...reservedLogsList, ...distributedLogsList];
    const performerIds = new Set<string>();
    const emailsLower = new Set<string>();
    for (const log of allLogs) {
      if (log.performed_by_user_id) performerIds.add(log.performed_by_user_id);
      if (log.source_consultant_email) emailsLower.add(log.source_consultant_email.trim().toLowerCase());
      if (log.target_consultant_email) emailsLower.add(log.target_consultant_email.trim().toLowerCase());
    }

    const performerNameById = new Map<string, string>();
    if (performerIds.size > 0) {
      const { data } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', Array.from(performerIds));
      for (const row of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
        const name = (row.full_name && row.full_name.trim()) || (row.email && row.email.trim()) || '';
        performerNameById.set(row.id, name);
      }
    }

    const emailToName = new Map<string, string>();
    if (emailsLower.size > 0) {
      const { data } = await supabaseServiceRole
        .from('profiles')
        .select('email, full_name')
        .not('email', 'is', null);
      for (const row of (data ?? []) as { email: string | null; full_name: string | null }[]) {
        const email = (row.email ?? '').trim().toLowerCase();
        if (email && emailsLower.has(email)) {
          const name = (row.full_name ?? row.email ?? '').trim();
          emailToName.set(email, name || email);
        }
      }
    }

    const DEFAULT_DEADLINE = 10;

    const mapReserved = (log: LogRow): HistoryItem => {
      const stock = stockByLogId.get(log.id) ?? { total: 0, em_estoque: 0, repassado: 0, cancelado: 0, balance: 0 };
      let status_label: HistoryItem['status_label'] = 'em_estoque';
      if (stock.em_estoque === 0 && stock.repassado > 0 && stock.cancelado === 0) status_label = 'repassado';
      else if (stock.cancelado > 0 && stock.em_estoque === 0 && stock.repassado === 0) status_label = 'cancelado_total';
      else if (stock.cancelado > 0) status_label = 'cancelado_parcial';

      const sourceEmailKey = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmailKey = (log.target_consultant_email ?? '').trim().toLowerCase();
      return {
        id: log.id,
        created_at: log.created_at,
        kind: 'reserved',
        transfer_kind: 'admin_to_gerente_stock',
        transfer_type: (log.transfer_type ?? 'TF').toString(),
        deadline_days: Number(log.deadline_days ?? DEFAULT_DEADLINE) || DEFAULT_DEADLINE,
        performed_by_user_id: log.performed_by_user_id,
        performed_by_name: log.performed_by_user_id ? performerNameById.get(log.performed_by_user_id) ?? null : null,
        source_consultant_email: log.source_consultant_email,
        source_consultant_name: sourceEmailKey ? emailToName.get(sourceEmailKey) ?? log.source_consultant_email : null,
        target_consultant_email: log.target_consultant_email,
        target_consultant_name: targetEmailKey ? emailToName.get(targetEmailKey) ?? log.target_consultant_email : null,
        count: Number(log.count ?? stock.total ?? 0) || 0,
        total_balance: stock.balance,
        stock_total: stock.total,
        stock_pending: stock.em_estoque,
        stock_distributed: stock.repassado,
        stock_canceled: stock.cancelado,
        status_label,
      };
    };

    const mapDistributed = (log: LogRow): HistoryItem => {
      const sourceEmailKey = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmailKey = (log.target_consultant_email ?? '').trim().toLowerCase();
      return {
        id: log.id,
        created_at: log.created_at,
        kind: 'distributed',
        transfer_kind: 'gerente_stock_to_consultant',
        transfer_type: (log.transfer_type ?? 'TF').toString(),
        deadline_days: Number(log.deadline_days ?? DEFAULT_DEADLINE) || DEFAULT_DEADLINE,
        performed_by_user_id: log.performed_by_user_id,
        performed_by_name: log.performed_by_user_id ? performerNameById.get(log.performed_by_user_id) ?? null : null,
        source_consultant_email: log.source_consultant_email,
        source_consultant_name: sourceEmailKey ? emailToName.get(sourceEmailKey) ?? log.source_consultant_email : null,
        target_consultant_email: log.target_consultant_email,
        target_consultant_name: targetEmailKey ? emailToName.get(targetEmailKey) ?? log.target_consultant_email : null,
        count: Number(log.count ?? 0) || 0,
        total_balance: Number(log.total_balance_snapshot ?? 0) || 0,
        stock_total: 0,
        stock_pending: 0,
        stock_distributed: 0,
        stock_canceled: 0,
        status_label: 'distribuido',
      };
    };

    const items: HistoryItem[] = [
      ...reservedLogsList.map(mapReserved),
      ...distributedLogsList.map(mapDistributed),
    ].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    const totals = {
      received: reservedLogsList.length,
      distributed: distributedLogsList.length,
      received_leads: reservedLogsList.reduce((acc, l) => acc + (Number(l.count) || 0), 0),
      distributed_leads: distributedLogsList.reduce((acc, l) => acc + (Number(l.count) || 0), 0),
    };

    return successResponse({ banca_id: bancaId, items, totals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
