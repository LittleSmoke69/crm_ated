import { NextRequest } from 'next/server';
import { isLeadStockAdminViewer, requireLeadStockViewer } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca, listGerenteUserIdsOnBanca } from '@/lib/server/crm/gerenteLeadStock';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/gerente/crm/lead-stock/history?banca_id=&gerente_user_id=
 *
 * - Gerente: histórico próprio na banca.
 * - Admin/super_admin: com gerente_user_id = só aquele gerente; sem = todos os gerentes da banca (visão mesclada).
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
  stock_gerente_user_id?: string | null;
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
  stock_gerente_user_id?: string | null;
  stock_gerente_name?: string | null;
};

const DEFAULT_DEADLINE = 10;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadStockViewer(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    const gerenteParam = req.nextUrl.searchParams.get('gerente_user_id')?.trim() || null;
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const admin = isLeadStockAdminViewer(profile);
    let mergedAdminAllGerentes = false;
    let stockScopeUserId: string;

    if (admin) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 404);
      if (gerenteParam) {
        const ok = await assertGerenteHasBanca(gerenteParam, bancaId);
        if (!ok) return errorResponse('Gerente não pertence a esta banca.', 403);
        stockScopeUserId = gerenteParam;
      } else {
        mergedAdminAllGerentes = true;
        stockScopeUserId = '';
      }
    } else {
      const has = await assertGerenteHasBanca(userId, bancaId);
      if (!has) return errorResponse('Banca não disponível.', 403);
      if (gerenteParam && gerenteParam !== userId) {
        return errorResponse('Sem permissão para consultar outro gerente.', 403);
      }
      stockScopeUserId = userId;
    }

    let reservedQuery = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, stock_status, saldo_snapshot, stock_gerente_user_id')
      .eq('banca_id', bancaId);

    if (!mergedAdminAllGerentes) {
      reservedQuery = reservedQuery.eq('stock_gerente_user_id', stockScopeUserId);
    } else {
      reservedQuery = reservedQuery.not('stock_gerente_user_id', 'is', null);
    }

    const { data: reservedEntries } = await reservedQuery;
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

    let distributedLogsList: LogRow[] = [];
    if (!mergedAdminAllGerentes) {
      const { data: distributedLogs } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select(
          'id, banca_id, created_at, transfer_type, deadline_days, transfer_kind, performed_by_user_id, source_consultant_email, target_consultant_email, count, total_balance_snapshot'
        )
        .eq('banca_id', bancaId)
        .eq('transfer_kind', 'gerente_stock_to_consultant')
        .eq('performed_by_user_id', stockScopeUserId);
      distributedLogsList = (Array.isArray(distributedLogs) ? distributedLogs : []) as LogRow[];
    } else {
      const gerenteIds = await listGerenteUserIdsOnBanca(bancaId);
      if (gerenteIds.length > 0) {
        const { data: distributedLogs } = await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .select(
            'id, banca_id, created_at, transfer_type, deadline_days, transfer_kind, performed_by_user_id, source_consultant_email, target_consultant_email, count, total_balance_snapshot'
          )
          .eq('banca_id', bancaId)
          .eq('transfer_kind', 'gerente_stock_to_consultant')
          .in('performed_by_user_id', gerenteIds);
        distributedLogsList = (Array.isArray(distributedLogs) ? distributedLogs : []) as LogRow[];
      }
    }

    const stockByLogId = new Map<
      string,
      { total: number; em_estoque: number; repassado: number; cancelado: number; balance: number; gerenteId: string | null }
    >();
    for (const e of reservedEntriesList) {
      const lid = e.transfer_log_id;
      const gid = (e.stock_gerente_user_id ?? '').trim() || null;
      const cur =
        stockByLogId.get(lid) ?? { total: 0, em_estoque: 0, repassado: 0, cancelado: 0, balance: 0, gerenteId: gid };
      if (!cur.gerenteId && gid) cur.gerenteId = gid;
      cur.total += 1;
      if (e.stock_status === 'em_estoque') cur.em_estoque += 1;
      else if (e.stock_status === 'repassado') cur.repassado += 1;
      else if (e.stock_status === 'cancelado') cur.cancelado += 1;
      cur.balance += e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0;
      stockByLogId.set(lid, cur);
    }

    const gerenteIdsForNames = new Set<string>();
    for (const v of stockByLogId.values()) {
      if (v.gerenteId) gerenteIdsForNames.add(v.gerenteId);
    }
    const gerenteNameById = new Map<string, string>();
    if (gerenteIdsForNames.size > 0) {
      const { data: gprofs } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', [...gerenteIdsForNames]);
      for (const row of (gprofs ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
        const name = (row.full_name && row.full_name.trim()) || (row.email && row.email.trim()) || '';
        gerenteNameById.set(row.id, name || row.email || '');
      }
    }

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

    const mapReserved = (log: LogRow): HistoryItem => {
      const agg = stockByLogId.get(log.id) ?? {
        total: 0,
        em_estoque: 0,
        repassado: 0,
        cancelado: 0,
        balance: 0,
        gerenteId: null,
      };
      let status_label: HistoryItem['status_label'] = 'em_estoque';
      if (agg.em_estoque === 0 && agg.repassado > 0 && agg.cancelado === 0) status_label = 'repassado';
      else if (agg.cancelado > 0 && agg.em_estoque === 0 && agg.repassado === 0) status_label = 'cancelado_total';
      else if (agg.cancelado > 0) status_label = 'cancelado_parcial';

      const sourceEmailKey = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmailKey = (log.target_consultant_email ?? '').trim().toLowerCase();
      const gid = agg.gerenteId;
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
        count: Number(log.count ?? agg.total ?? 0) || 0,
        total_balance: agg.balance,
        stock_total: agg.total,
        stock_pending: agg.em_estoque,
        stock_distributed: agg.repassado,
        stock_canceled: agg.cancelado,
        status_label,
        ...(mergedAdminAllGerentes && gid
          ? {
              stock_gerente_user_id: gid,
              stock_gerente_name: gerenteNameById.get(gid) ?? null,
            }
          : {}),
      };
    };

    const mapDistributed = (log: LogRow): HistoryItem => {
      const sourceEmailKey = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmailKey = (log.target_consultant_email ?? '').trim().toLowerCase();
      const perfId = log.performed_by_user_id ?? '';
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
        ...(mergedAdminAllGerentes && perfId
          ? {
              stock_gerente_user_id: perfId,
              stock_gerente_name: performerNameById.get(perfId) ?? null,
            }
          : {}),
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

    return successResponse({
      banca_id: bancaId,
      viewer_role: admin ? 'admin' : 'gerente',
      merged_all_gerentes: mergedAdminAllGerentes,
      gerente_user_id_filter: mergedAdminAllGerentes ? null : stockScopeUserId || null,
      items,
      totals,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
