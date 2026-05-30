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
 *   - outflow_page (opcional, default=1): página do leads_outflow (1-based)
 *   - outflow_page_size (opcional, default=50, max=200): itens por página
 *   - outflow_filter (opcional): all|left|stayed — filtra leads_outflow no servidor
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const consultantEmailRaw = searchParams.get('consultant_email')?.trim() || null;
    /** Bloqueia caracteres que poderiam quebrar o filtro `.or()` do PostgREST. */
    const consultantEmail =
      consultantEmailRaw && /^[^,()\s]+@[^,()\s]+$/.test(consultantEmailRaw) ? consultantEmailRaw : null;
    if (consultantEmailRaw && !consultantEmail) {
      return errorResponse('consultant_email inválido.', 400);
    }
    const leadIdsParam = searchParams.get('lead_ids')?.trim() || null;
    const logId = searchParams.get('log_id')?.trim() || null;

    const outflowPage = Math.max(1, Number(searchParams.get('outflow_page') ?? '1') || 1);
    const outflowPageSize = Math.min(
      200,
      Math.max(1, Number(searchParams.get('outflow_page_size') ?? '50') || 50)
    );
    const outflowFilterRaw = (searchParams.get('outflow_filter') ?? 'all').toLowerCase();
    const outflowFilter: 'all' | 'left' | 'stayed' =
      outflowFilterRaw === 'left' || outflowFilterRaw === 'stayed' ? outflowFilterRaw : 'all';

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

    /**
     * ─── 6. leads_outflow — só quando filtra por consultant_email sem lead_ids ───
     * Para cada lead que algum dia foi target do titular, deduzir:
     *   - source_log_id: log mais antigo onde target == titular (entrada do lead no titular)
     *   - root_source_email: source desse primeiro log (ou original_source_consultant_email se preenchido)
     *   - current_holder_email: target do log mais recente onde o lead aparece
     *   - left_titular: current_holder_email !== titular
     */
    type OutflowItem = {
      lead_id: string;
      lead_email: string | null;
      root_source_email: string | null;
      source_log_id: string | null;
      source_log_created_at: string | null;
      current_holder_email: string | null;
      current_log_id: string | null;
      current_log_created_at: string | null;
      last_resolution_status: string | null;
      last_resolved_at: string | null;
      left_titular: boolean;
    };

    let leadsOutflow: {
      page: number;
      page_size: number;
      total: number;
      filter: 'all' | 'left' | 'stayed';
      items: OutflowItem[];
    } | null = null;

    if (consultantEmail && leadIds.length === 0) {
      const titularLower = consultantEmail.toLowerCase();

      type OutflowEntryRow = {
        lead_id: string | number | null;
        transfer_log_id: string | null;
        lead_email: string | null;
        original_source_consultant_email: string | null;
      };

      const { data: targetEntries, error: targetEntriesError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id, transfer_log_id, lead_email, original_source_consultant_email')
        .eq('banca_id', resolvedBancaId)
        .eq('target_consultant_email', consultantEmail);

      if (!targetEntriesError && Array.isArray(targetEntries) && targetEntries.length > 0) {
        const rows = targetEntries as OutflowEntryRow[];

        const allowedLogIds = gerenteLeadTransferOwnActionsOnly(profile)
          ? await (async () => {
              const uids = [...new Set(rows.map((r) => r.transfer_log_id).filter(Boolean) as string[])];
              if (uids.length === 0) return new Set<string>();
              const { data: meta } = await supabaseServiceRole
                .from('admin_lead_transfer_logs')
                .select('id')
                .in('id', uids)
                .eq('performed_by_user_id', userId);
              return new Set((meta ?? []).map((m: { id: string }) => m.id));
            })()
          : null;

        const filteredRows = allowedLogIds
          ? rows.filter((r) => r.transfer_log_id && allowedLogIds.has(r.transfer_log_id))
          : rows;

        const uniqueLeadIds = [...new Set(filteredRows.map((r) => String(r.lead_id ?? '').trim()).filter(Boolean))];

        if (uniqueLeadIds.length > 0) {
          /** Histórico completo dos leads do titular (em chunks para evitar query gigante). */
          type HistRow = {
            lead_id: string | number | null;
            transfer_log_id: string | null;
            source_consultant_email: string | null;
            target_consultant_email: string | null;
            resolution_status: string | null;
            resolved_at: string | null;
            lead_email: string | null;
            original_source_consultant_email: string | null;
          };
          const CHUNK = 500;
          const allHist: HistRow[] = [];
          for (let i = 0; i < uniqueLeadIds.length; i += CHUNK) {
            const slice = uniqueLeadIds.slice(i, i + CHUNK);
            const { data: histChunk } = await supabaseServiceRole
              .from('admin_lead_transfer_entries')
              .select(
                'lead_id, transfer_log_id, source_consultant_email, target_consultant_email, resolution_status, resolved_at, lead_email, original_source_consultant_email'
              )
              .eq('banca_id', resolvedBancaId)
              .in('lead_id', slice);
            if (Array.isArray(histChunk)) allHist.push(...(histChunk as HistRow[]));
          }

          /** Mapa de log_id → created_at (usa allLogs do passo 1 + busca extras se houver). */
          const logCreatedAt = new Map<string, string | null>();
          for (const l of allLogs) logCreatedAt.set(l.id, l.created_at);
          const extraLogIds = [
            ...new Set(allHist.map((h) => h.transfer_log_id).filter((id): id is string => !!id && !logCreatedAt.has(id))),
          ];
          if (extraLogIds.length > 0) {
            for (let i = 0; i < extraLogIds.length; i += 200) {
              const slice = extraLogIds.slice(i, i + 200);
              const { data: extraLogsData } = await supabaseServiceRole
                .from('admin_lead_transfer_logs')
                .select('id, created_at')
                .eq('banca_id', resolvedBancaId)
                .in('id', slice);
              if (Array.isArray(extraLogsData)) {
                for (const l of extraLogsData as Array<{ id: string; created_at: string | null }>) {
                  logCreatedAt.set(l.id, l.created_at);
                }
              }
            }
          }

          /** Agrupa histórico por lead_id, ordena por log_created_at ASC para deduzir raiz / DESC para current. */
          const histByLead = new Map<string, HistRow[]>();
          for (const h of allHist) {
            const lid = String(h.lead_id ?? '').trim();
            if (!lid) continue;
            const arr = histByLead.get(lid) ?? [];
            arr.push(h);
            histByLead.set(lid, arr);
          }

          const ts = (logId: string | null): number => {
            if (!logId) return 0;
            const c = logCreatedAt.get(logId);
            return c ? new Date(c).getTime() : 0;
          };

          const allItems: OutflowItem[] = uniqueLeadIds.map((lid) => {
            const rowsForLead = (histByLead.get(lid) ?? []).slice().sort((a, b) => ts(a.transfer_log_id) - ts(b.transfer_log_id));
            const oldest = rowsForLead[0] ?? null;
            const newest = rowsForLead[rowsForLead.length - 1] ?? null;
            const titularEntry = rowsForLead.find(
              (r) => (r.target_consultant_email ?? '').toLowerCase() === titularLower
            ) ?? null;
            /** Origem raiz: priorizar original_source_consultant_email; senão source do log mais antigo. */
            const originalSource = rowsForLead
              .map((r) => (r.original_source_consultant_email ?? '').trim())
              .find((x) => x.includes('@')) ?? null;
            const rootSource = originalSource || oldest?.source_consultant_email || null;
            const currentHolder = newest?.target_consultant_email ?? null;
            const leadEmail = rowsForLead.find((r) => (r.lead_email ?? '').includes('@'))?.lead_email ?? null;
            return {
              lead_id: lid,
              lead_email: leadEmail,
              root_source_email: rootSource,
              source_log_id: titularEntry?.transfer_log_id ?? oldest?.transfer_log_id ?? null,
              source_log_created_at: titularEntry?.transfer_log_id
                ? logCreatedAt.get(titularEntry.transfer_log_id) ?? null
                : oldest?.transfer_log_id
                  ? logCreatedAt.get(oldest.transfer_log_id) ?? null
                  : null,
              current_holder_email: currentHolder,
              current_log_id: newest?.transfer_log_id ?? null,
              current_log_created_at: newest?.transfer_log_id ? logCreatedAt.get(newest.transfer_log_id) ?? null : null,
              last_resolution_status: newest?.resolution_status ?? null,
              last_resolved_at: newest?.resolved_at ?? null,
              left_titular: (currentHolder ?? '').toLowerCase() !== titularLower,
            };
          });

          const filteredItems =
            outflowFilter === 'left'
              ? allItems.filter((i) => i.left_titular)
              : outflowFilter === 'stayed'
                ? allItems.filter((i) => !i.left_titular)
                : allItems;

          /** Ordena: leads que saíram (mais recentes primeiro), depois os que ficaram. */
          filteredItems.sort((a, b) => {
            if (a.left_titular !== b.left_titular) return a.left_titular ? -1 : 1;
            const ta = a.current_log_created_at ? new Date(a.current_log_created_at).getTime() : 0;
            const tb = b.current_log_created_at ? new Date(b.current_log_created_at).getTime() : 0;
            return tb - ta;
          });

          const total = filteredItems.length;
          const start = (outflowPage - 1) * outflowPageSize;
          const pageItems = filteredItems.slice(start, start + outflowPageSize);
          leadsOutflow = {
            page: outflowPage,
            page_size: outflowPageSize,
            total,
            filter: outflowFilter,
            items: pageItems,
          };
        } else {
          leadsOutflow = { page: outflowPage, page_size: outflowPageSize, total: 0, filter: outflowFilter, items: [] };
        }
      } else if (!targetEntriesError) {
        leadsOutflow = { page: outflowPage, page_size: outflowPageSize, total: 0, filter: outflowFilter, items: [] };
      } else {
        console.warn(`${LOG_PREFIX} GET leads_outflow target entries error (não fatal):`, targetEntriesError);
      }
    }

    return successResponse({
      timeline,
      lead_history: leadHistory,
      current_holders: currentHolders,
      leads_outflow: leadsOutflow,
      meta: {
        banca_id: resolvedBancaId,
        consultant_email: consultantEmail,
        lead_ids_queried: leadIds,
        logs_found: allLogs.length,
        entries_found: entries.length,
        outflow_page: outflowPage,
        outflow_page_size: outflowPageSize,
        outflow_filter: outflowFilter,
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
