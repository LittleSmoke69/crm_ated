import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getLeadTransferBancaAccess, gerenteLeadTransferOwnActionsOnly } from '@/lib/server/crm/adminLeadTransferContext';

const LOG_PREFIX = '[admin][lead-trace]';

/**
 * GET /api/admin/crm/transfer-logs/lead-trace
 *
 * Retorna o histórico completo de transferências de um consultor ou de leads específicos.
 * Útil para diagnosticar desync CRM↔DB (ex: "Onde estão esses leads agora?").
 *
 * Query params:
 *   - banca_id (obrigatório)
 *   - consultant_email (opcional): filtra logs onde é source ou target
 *   - lead_ids (opcional): IDs separados por vírgula (ex: "6205,6221,6227")
 *   - log_id (opcional): rastreia um log específico e seus relacionados
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const consultantEmail = searchParams.get('consultant_email')?.trim() || null;
    const leadIdsParam = searchParams.get('lead_ids')?.trim() || null;
    const logId = searchParams.get('log_id')?.trim() || null;

    if (!bancaId) return errorResponse('banca_id é obrigatório.');

    const resolved = await getLeadTransferBancaAccess(userId, profile, bancaId);
    if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);

    const resolvedBancaId = resolved.bancaId;
    const leadIds = leadIdsParam
      ? leadIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // ─── 1. Buscar logs relevantes ─────────────────────────────────────────
    type LogRow = {
      id: string;
      banca_id: string;
      source_consultant_email: string | null;
      target_consultant_email: string | null;
      transfer_type: string | null;
      deadline_days: number | null;
      created_at: string | null;
      leads_ids: unknown;
    };

    let logsQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, source_consultant_email, target_consultant_email, transfer_type, deadline_days, created_at, leads_ids')
      .eq('banca_id', resolvedBancaId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (gerenteLeadTransferOwnActionsOnly(profile)) {
      logsQuery = logsQuery.eq('performed_by_user_id', userId);
    }

    if (logId) {
      logsQuery = logsQuery.eq('id', logId);
    } else if (consultantEmail) {
      logsQuery = logsQuery.or(
        `source_consultant_email.eq.${consultantEmail},target_consultant_email.eq.${consultantEmail}`
      );
    }

    const { data: logs, error: logsError } = await logsQuery;
    if (logsError) {
      console.error(`${LOG_PREFIX} GET logs error:`, logsError);
      return serverErrorResponse(logsError);
    }

    const allLogs: LogRow[] = Array.isArray(logs) ? (logs as LogRow[]) : [];
    const logIds = allLogs.map((l) => l.id);

    // ─── 2. Buscar entries dos logs encontrados ────────────────────────────
    type EntryRow = {
      transfer_log_id: string;
      lead_id: string;
      source_consultant_email: string | null;
      target_consultant_email: string | null;
      resolution_status: string | null;
      resolved_at: string | null;
      transfer_type: string | null;
      had_balance: boolean | null;
      saldo_snapshot: number | null;
    };

    let entries: EntryRow[] = [];
    if (logIds.length > 0) {
      let entriesQuery = supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('transfer_log_id, lead_id, source_consultant_email, target_consultant_email, resolution_status, resolved_at, transfer_type, had_balance, saldo_snapshot')
        .eq('banca_id', resolvedBancaId)
        .in('transfer_log_id', logIds)
        .order('transfer_log_id', { ascending: false });

      if (leadIds.length > 0) {
        entriesQuery = entriesQuery.in('lead_id', leadIds);
      }

      const { data: entriesData, error: entriesError } = await entriesQuery;
      if (entriesError) {
        console.warn(`${LOG_PREFIX} GET entries error (não fatal):`, entriesError);
      } else {
        entries = Array.isArray(entriesData) ? (entriesData as EntryRow[]) : [];
      }
    }

    // ─── 3. Se filtramos por lead_ids, buscar TODOS os logs que contêm esses leads ──
    // (para rastrear o histórico completo do lead, mesmo em logs não do consultor)
    let leadHistory: Array<{
      lead_id: string;
      log_id: string;
      log_created_at: string | null;
      source_consultant_email: string | null;
      target_consultant_email: string | null;
      resolution_status: string | null;
      resolved_at: string | null;
      transfer_type: string | null;
      had_balance: boolean | null;
      saldo_snapshot: number | null;
    }> = [];

    if (leadIds.length > 0) {
      const { data: allLeadEntries, error: allEntriesError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('transfer_log_id, lead_id, source_consultant_email, target_consultant_email, resolution_status, resolved_at, transfer_type, had_balance, saldo_snapshot')
        .eq('banca_id', resolvedBancaId)
        .in('lead_id', leadIds)
        .order('transfer_log_id', { ascending: false });

      if (!allEntriesError && Array.isArray(allLeadEntries)) {
        let rows = allLeadEntries as EntryRow[];
        if (gerenteLeadTransferOwnActionsOnly(profile)) {
          const uids = [...new Set(rows.map((e) => e.transfer_log_id).filter(Boolean))];
          if (uids.length === 0) {
            rows = [];
          } else {
            const { data: meta } = await supabaseServiceRole
              .from('admin_lead_transfer_logs')
              .select('id')
              .in('id', uids)
              .eq('performed_by_user_id', userId);
            const allowed = new Set((meta ?? []).map((m: { id: string }) => m.id));
            rows = rows.filter((e) => allowed.has(e.transfer_log_id));
          }
        }

        // Buscar logs relacionados a essas entries (podem ser de consultores diferentes)
        const extraLogIds = [...new Set(rows.map((e) => e.transfer_log_id).filter(Boolean))].filter((id) => !logIds.includes(id));

        let extraLogs: LogRow[] = [];
        if (extraLogIds.length > 0) {
          let extraQ = supabaseServiceRole
            .from('admin_lead_transfer_logs')
            .select('id, banca_id, source_consultant_email, target_consultant_email, transfer_type, deadline_days, created_at, leads_ids')
            .eq('banca_id', resolvedBancaId)
            .in('id', extraLogIds);
          if (gerenteLeadTransferOwnActionsOnly(profile)) {
            extraQ = extraQ.eq('performed_by_user_id', userId);
          }
          const { data: extraLogsData } = await extraQ;
          extraLogs = Array.isArray(extraLogsData) ? (extraLogsData as LogRow[]) : [];
        }

        const allLogsMap = new Map<string, LogRow>(
          [...allLogs, ...extraLogs].map((l) => [l.id, l])
        );

        leadHistory = rows.map((e) => {
          const log = allLogsMap.get(e.transfer_log_id);
          return {
            lead_id: e.lead_id,
            log_id: e.transfer_log_id,
            log_created_at: log?.created_at ?? null,
            source_consultant_email: e.source_consultant_email ?? log?.source_consultant_email ?? null,
            target_consultant_email: e.target_consultant_email ?? log?.target_consultant_email ?? null,
            resolution_status: e.resolution_status ?? null,
            resolved_at: e.resolved_at ?? null,
            transfer_type: e.transfer_type ?? log?.transfer_type ?? null,
            had_balance: e.had_balance ?? null,
            saldo_snapshot: e.saldo_snapshot ?? null,
          };
        }).sort((a, b) => {
          if (!a.log_created_at) return 1;
          if (!b.log_created_at) return -1;
          return new Date(b.log_created_at).getTime() - new Date(a.log_created_at).getTime();
        });
      }
    }

    // ─── 4. Montar timeline por log ────────────────────────────────────────
    const entriesByLog = new Map<string, EntryRow[]>();
    for (const e of entries) {
      const arr = entriesByLog.get(e.transfer_log_id) ?? [];
      arr.push(e);
      entriesByLog.set(e.transfer_log_id, arr);
    }

    const statusOrder: Record<string, number> = {
      repassado: 0,
      vinculado: 1,
      disponivel_retransferencia: 2,
      pending: 3,
    };

    const timeline = allLogs.map((log) => {
      const logEntries = entriesByLog.get(log.id) ?? [];
      const statusCount: Record<string, number> = {};
      for (const e of logEntries) {
        const st = e.resolution_status ?? 'pending';
        statusCount[st] = (statusCount[st] ?? 0) + 1;
      }
      const rawLeadsIds = Array.isArray(log.leads_ids) ? (log.leads_ids as unknown[]) : [];

      return {
        log_id: log.id,
        created_at: log.created_at,
        source_consultant_email: log.source_consultant_email,
        target_consultant_email: log.target_consultant_email,
        transfer_type: log.transfer_type,
        deadline_days: log.deadline_days,
        leads_total: rawLeadsIds.length,
        entries_loaded: logEntries.length,
        status_breakdown: statusCount,
        // Para leads específicos: mostrar estado de cada um
        tracked_leads: leadIds.length > 0
          ? logEntries
              .filter((e) => leadIds.includes(String(e.lead_id)))
              .sort((a, b) => {
                const sa = statusOrder[a.resolution_status ?? ''] ?? 99;
                const sb = statusOrder[b.resolution_status ?? ''] ?? 99;
                return sa - sb;
              })
              .map((e) => ({
                lead_id: e.lead_id,
                resolution_status: e.resolution_status,
                resolved_at: e.resolved_at,
              }))
          : [],
      };
    });

    // ─── 5. Resumo: onde estão os leads rastreados agora ──────────────────
    let currentHolders: Array<{ email: string; count: number; statuses: string[] }> = [];
    if (leadIds.length > 0 && leadHistory.length > 0) {
      // Pegar o estado MAIS RECENTE de cada lead
      const latestByLead = new Map<string, typeof leadHistory[0]>();
      for (const h of leadHistory) {
        const existing = latestByLead.get(h.lead_id);
        if (!existing || (h.log_created_at && (!existing.log_created_at || new Date(h.log_created_at) > new Date(existing.log_created_at)))) {
          latestByLead.set(h.lead_id, h);
        }
      }

      const holderMap = new Map<string, { count: number; statuses: Set<string> }>();
      for (const entry of latestByLead.values()) {
        const email = entry.target_consultant_email ?? 'desconhecido';
        const existing = holderMap.get(email) ?? { count: 0, statuses: new Set() };
        existing.count++;
        if (entry.resolution_status) existing.statuses.add(entry.resolution_status);
        holderMap.set(email, existing);
      }

      currentHolders = [...holderMap.entries()].map(([email, data]) => ({
        email,
        count: data.count,
        statuses: [...data.statuses],
      })).sort((a, b) => b.count - a.count);
    }

    return successResponse({
      timeline,
      lead_history: leadHistory,
      current_holders: currentHolders,
      meta: {
        banca_id: resolvedBancaId,
        consultant_email: consultantEmail,
        lead_ids_queried: leadIds,
        logs_found: allLogs.length,
        entries_found: entries.length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
