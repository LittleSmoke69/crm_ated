import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { buildConsultantAllLeadIds, leadIdMatchKey } from '@/lib/server/crm/crmLeadIdsForCrmApi';

const LOG_PREFIX = '[admin][locate-leads]';

export type CrmHolder = 'origin' | 'dest' | 'ambiguous' | null;

export type LocateLeadRow = {
  lead_id: string;
  resolution_status: string | null;
  expected_consultant: string | null;
  db_target: string | null;
  in_origin_crm: boolean;
  in_dest_crm: boolean;
  crm_holder: CrmHolder;
  crm_holder_email: string | null;
  is_with_expected: boolean;
  needs_db_correction: boolean;
  session_error: boolean;
};

export type LocateLeadsResult = {
  log: {
    log_id: string;
    source_consultant_email: string | null;
    target_consultant_email: string | null;
    transfer_type: string | null;
    created_at: string | null;
    status_breakdown: Record<string, number>;
    leads_total: number;
  };
  crm_check: {
    origin: { email: string; total_leads_crm: number; ids_from_batch: number; partial: boolean };
    dest: { email: string; total_leads_crm: number; ids_from_batch: number; partial: boolean };
    batch_only_in_origin: number;
    batch_only_in_dest: number;
    batch_in_both: number;
    batch_in_neither: number;
    batch_aligned_with_dest: number;
  };
  summary: {
    total: number;
    ok: number;
    with_origin: number;
    with_dest: number;
    ambiguous: number;
    not_in_crm: number;
    pending: number;
    needs_correction: number;
  };
  items: LocateLeadRow[];
  all_items: LocateLeadRow[];
  total_filtered: number;
  crm_partial: boolean;
};

type LogRow = {
  id: string;
  source_consultant_email: string | null;
  target_consultant_email: string | null;
  transfer_type: string | null;
  created_at: string | null;
  leads_ids: unknown;
};

type EntryRow = {
  lead_id: string | number;
  target_consultant_email: string | null;
  resolution_status: string | null;
};

function inferCrmHolder(
  inOrigin: boolean,
  inDest: boolean,
  originEmail: string,
  destEmail: string
): { holder: CrmHolder; email: string | null } {
  if (inOrigin && inDest) return { holder: 'ambiguous', email: null };
  if (inOrigin) return { holder: 'origin', email: originEmail };
  if (inDest) return { holder: 'dest', email: destEmail };
  return { holder: null, email: null };
}

function emailMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

export async function locateLeadsForLog(params: {
  bancaId: string;
  crmBaseUrl: string;
  logId: string;
  leadIdsFilter?: string[];
  sessionErrorLeadIds?: Set<string>;
  sessionOnly?: boolean;
  page?: number;
  pageSize?: number;
  filter?: 'all' | 'mismatch' | 'pending' | 'not_in_crm' | 'session_error' | 'needs_correction';
}): Promise<LocateLeadsResult> {
  const {
    bancaId,
    crmBaseUrl,
    logId,
    leadIdsFilter,
    sessionErrorLeadIds,
    sessionOnly = false,
    page = 1,
    pageSize = 100,
    filter = 'all',
  } = params;

  const { data: logData, error: logError } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, source_consultant_email, target_consultant_email, transfer_type, created_at, leads_ids')
    .eq('banca_id', bancaId)
    .eq('id', logId)
    .single();

  if (logError || !logData) {
    throw new Error('Pacote (log) não encontrado.');
  }

  const log = logData as LogRow;
  const originEmail = (log.source_consultant_email ?? '').trim();
  const destEmail = (log.target_consultant_email ?? '').trim();

  const { data: entriesData, error: entriesError } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('lead_id, target_consultant_email, resolution_status')
    .eq('banca_id', bancaId)
    .eq('transfer_log_id', logId);

  if (entriesError) {
    console.error(`${LOG_PREFIX} entries error:`, entriesError);
    throw new Error('Erro ao buscar entries do pacote.');
  }

  const entries = (Array.isArray(entriesData) ? entriesData : []) as EntryRow[];
  const statusBreakdown: Record<string, number> = {};
  const entryByLeadId = new Map<string, EntryRow>();
  for (const e of entries) {
    const lid = String(e.lead_id ?? '').trim();
    if (!lid) continue;
    entryByLeadId.set(lid, e);
    const st = e.resolution_status ?? 'pending';
    statusBreakdown[st] = (statusBreakdown[st] ?? 0) + 1;
  }

  let batchLeadIds = [...entryByLeadId.keys()];
  if (leadIdsFilter && leadIdsFilter.length > 0) {
    const filterSet = new Set(leadIdsFilter.map((id) => leadIdMatchKey(id)));
    batchLeadIds = batchLeadIds.filter((id) => filterSet.has(leadIdMatchKey(id)));
  }
  if (sessionOnly && sessionErrorLeadIds && sessionErrorLeadIds.size > 0) {
    batchLeadIds = batchLeadIds.filter(
      (id) => sessionErrorLeadIds.has(id) || sessionErrorLeadIds.has(leadIdMatchKey(id))
    );
  }

  const client = createCrmRedistributionClient(crmBaseUrl);
  let crmPartial = false;
  let originSet = new Set<string>();
  let destSet = new Set<string>();
  let originCounts = { no: 0, yes: 0, total: 0 };
  let destCounts = { no: 0, yes: 0, total: 0 };

  if (originEmail.includes('@')) {
    const r = await buildConsultantAllLeadIds(client, originEmail);
    originSet = r.allIds;
    originCounts = r.counts;
    if (r.partial) crmPartial = true;
  }
  if (destEmail.includes('@')) {
    const r = await buildConsultantAllLeadIds(client, destEmail);
    destSet = r.allIds;
    destCounts = r.counts;
    if (r.partial) crmPartial = true;
  }

  let batchOnlyOrigin = 0;
  let batchOnlyDest = 0;
  let batchInBoth = 0;
  let batchInNeither = 0;
  let batchAlignedDest = 0;

  const allRows: LocateLeadRow[] = batchLeadIds.map((leadId) => {
    const key = leadIdMatchKey(leadId);
    const entry = entryByLeadId.get(leadId) ?? entryByLeadId.get(key);
    const resolutionStatus = entry?.resolution_status ?? null;
    const expectedConsultant = destEmail.includes('@') ? destEmail : null;
    const inOrigin = originSet.has(key);
    const inDest = destSet.has(key);
    const { holder, email: crmHolderEmail } = inferCrmHolder(inOrigin, inDest, originEmail, destEmail);

    if (inOrigin && inDest) batchInBoth += 1;
    else if (inOrigin) batchOnlyOrigin += 1;
    else if (inDest) batchOnlyDest += 1;
    else batchInNeither += 1;

    const isWithExpected = emailMatch(crmHolderEmail, expectedConsultant);
    if (isWithExpected) batchAlignedDest += 1;

    const sessionError =
      sessionErrorLeadIds != null &&
      (sessionErrorLeadIds.has(leadId) || sessionErrorLeadIds.has(key));
    const needsDbCorrection = sessionError && !isWithExpected;

    return {
      lead_id: leadId,
      resolution_status: resolutionStatus,
      expected_consultant: expectedConsultant,
      db_target: entry?.target_consultant_email ?? null,
      in_origin_crm: inOrigin,
      in_dest_crm: inDest,
      crm_holder: holder,
      crm_holder_email: crmHolderEmail,
      is_with_expected: isWithExpected,
      needs_db_correction: needsDbCorrection,
      session_error: sessionError,
    };
  });

  const summary = {
    total: allRows.length,
    ok: allRows.filter((r) => r.is_with_expected).length,
    with_origin: allRows.filter((r) => r.crm_holder === 'origin').length,
    with_dest: allRows.filter((r) => r.crm_holder === 'dest').length,
    ambiguous: allRows.filter((r) => r.crm_holder === 'ambiguous').length,
    not_in_crm: allRows.filter((r) => r.crm_holder === null).length,
    pending: allRows.filter((r) => r.resolution_status === 'pending').length,
    needs_correction: allRows.filter((r) => r.needs_db_correction).length,
  };

  const filteredRows = allRows.filter((r) => {
    if (filter === 'mismatch') return !r.is_with_expected;
    if (filter === 'pending') return r.resolution_status === 'pending';
    if (filter === 'not_in_crm') return r.crm_holder === null;
    if (filter === 'session_error') return r.session_error;
    if (filter === 'needs_correction') return r.needs_db_correction;
    return true;
  });

  const safePage = Math.max(1, page);
  const safePageSize = Math.min(500, Math.max(1, pageSize));
  const start = (safePage - 1) * safePageSize;
  const pageItems = filteredRows.slice(start, start + safePageSize);

  const rawLeadsIds = Array.isArray(log.leads_ids) ? (log.leads_ids as unknown[]) : [];

  return {
    log: {
      log_id: log.id,
      source_consultant_email: log.source_consultant_email,
      target_consultant_email: log.target_consultant_email,
      transfer_type: log.transfer_type,
      created_at: log.created_at,
      status_breakdown: statusBreakdown,
      leads_total: rawLeadsIds.length || entries.length,
    },
    crm_check: {
      origin: {
        email: originEmail,
        total_leads_crm: originCounts.total,
        ids_from_batch: batchOnlyOrigin + batchInBoth,
        partial: crmPartial,
      },
      dest: {
        email: destEmail,
        total_leads_crm: destCounts.total,
        ids_from_batch: batchOnlyDest + batchInBoth,
        partial: crmPartial,
      },
      batch_only_in_origin: batchOnlyOrigin,
      batch_only_in_dest: batchOnlyDest,
      batch_in_both: batchInBoth,
      batch_in_neither: batchInNeither,
      batch_aligned_with_dest: batchAlignedDest,
    },
    summary,
    items: pageItems,
    all_items: allRows,
    total_filtered: filteredRows.length,
    crm_partial: crmPartial,
  };
}

export type SyncEntryAction = 'unchanged_ok' | 'mark_disponivel' | 'manual_review';

export type SyncEntryResult = {
  lead_id: string;
  action: SyncEntryAction;
  previous_status: string | null;
  new_status: string | null;
  reason?: string;
};

export async function syncEntriesFromCrmLocate(params: {
  bancaId: string;
  crmBaseUrl: string;
  logId: string;
  leadIds?: string[];
  sessionErrorLeadIds?: Set<string>;
  dryRun?: boolean;
}): Promise<{
  corrected: number;
  unchanged_ok: number;
  manual_review: Array<{ lead_id: string; reason: string }>;
  results: SyncEntryResult[];
}> {
  const locate = await locateLeadsForLog({
    bancaId: params.bancaId,
    crmBaseUrl: params.crmBaseUrl,
    logId: params.logId,
    leadIdsFilter: params.leadIds,
    sessionErrorLeadIds: params.sessionErrorLeadIds,
    page: 1,
    pageSize: 500,
    filter: 'all',
  });

  const pool = params.sessionErrorLeadIds?.size
    ? locate.all_items.filter(
        (r) =>
          r.session_error ||
          r.needs_db_correction ||
          (params.leadIds?.some((id) => leadIdMatchKey(id) === leadIdMatchKey(r.lead_id)) ?? false)
      )
    : params.leadIds?.length
      ? locate.all_items.filter((r) =>
          params.leadIds!.some((id) => leadIdMatchKey(id) === leadIdMatchKey(r.lead_id))
        )
      : locate.all_items.filter((r) => r.session_error || r.needs_db_correction);

  const results: SyncEntryResult[] = [];
  const manualReview: Array<{ lead_id: string; reason: string }> = [];
  let corrected = 0;
  let unchangedOk = 0;

  for (const row of pool) {
    if (row.is_with_expected) {
      results.push({
        lead_id: row.lead_id,
        action: 'unchanged_ok',
        previous_status: row.resolution_status,
        new_status: row.resolution_status,
      });
      unchangedOk += 1;
      continue;
    }

    if (row.crm_holder === 'ambiguous') {
      manualReview.push({ lead_id: row.lead_id, reason: 'Lead aparece na origem e no destino no CRM' });
      results.push({
        lead_id: row.lead_id,
        action: 'manual_review',
        previous_status: row.resolution_status,
        new_status: row.resolution_status,
        reason: 'ambiguous',
      });
      continue;
    }

    if (row.crm_holder === null) {
      manualReview.push({ lead_id: row.lead_id, reason: 'Lead não encontrado na origem nem no destino no CRM' });
      results.push({
        lead_id: row.lead_id,
        action: 'manual_review',
        previous_status: row.resolution_status,
        new_status: row.resolution_status,
        reason: 'not_in_crm',
      });
      continue;
    }

    if (row.crm_holder === 'origin' && !row.in_dest_crm) {
      const prev = row.resolution_status;
      if (!params.dryRun) {
        const { error } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .update({
            resolution_status: 'disponivel_retransferencia',
            resolved_at: new Date().toISOString(),
          })
          .eq('banca_id', params.bancaId)
          .eq('transfer_log_id', params.logId)
          .eq('lead_id', row.lead_id);
        if (error) {
          manualReview.push({ lead_id: row.lead_id, reason: `Erro ao atualizar: ${error.message}` });
          results.push({
            lead_id: row.lead_id,
            action: 'manual_review',
            previous_status: prev,
            new_status: prev,
            reason: error.message,
          });
          continue;
        }
      }
      results.push({
        lead_id: row.lead_id,
        action: 'mark_disponivel',
        previous_status: prev,
        new_status: 'disponivel_retransferencia',
      });
      corrected += 1;
      continue;
    }

    manualReview.push({ lead_id: row.lead_id, reason: 'Situação não mapeada para correção automática' });
    results.push({
      lead_id: row.lead_id,
      action: 'manual_review',
      previous_status: row.resolution_status,
      new_status: row.resolution_status,
    });
  }

  return { corrected, unchanged_ok: unchangedOk, manual_review: manualReview, results };
}
