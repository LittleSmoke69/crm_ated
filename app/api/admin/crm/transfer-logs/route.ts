import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { getGerenteUserBancaIds, gerenteLeadTransferOwnActionsOnly } from '@/lib/server/crm/adminLeadTransferContext';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const LOG_PREFIX = '[admin][transfer-logs]';
/** Tamanho da página por request (PostgREST costuma limitar ~1000). */
const LOGS_PAGE_SIZE = 1000;
/** Máximo de páginas para não travar (ex.: 100k logs). */
const LOGS_MAX_PAGES = 100;
const IN_BATCH_SIZE = 150;
const ENTRIES_PAGE_SIZE = 10000;
/** Limite de linhas de log escaneadas no fallback JSON (evita timeout em bases enormes). */
const LEAD_EMAIL_JSON_FALLBACK_MAX_ROWS = 12_000;
const LEAD_EMAIL_JSON_FALLBACK_PAGE = 400;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Termo de busca: só trim + minúsculas (sem remover `@` ou pontos — é o e-mail digitado). */
function normalizeLeadEmailSearchTerm(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Fallback: o e-mail pode aparecer em crm_response / filters_snapshot (transferências antigas).
 * Escaneia logs recentes primeiro (created_at desc), até LEAD_EMAIL_JSON_FALLBACK_MAX_ROWS.
 */
async function collectTransferLogIdsFromLogsJsonEmailFallback(
  norm: string,
  bancaId: string | null,
  gerenteBancaIds: string[] | null
): Promise<string[]> {
  if (norm.length < 5 || !norm.includes('@')) return [];
  const found = new Set<string>();
  let offset = 0;
  let scanned = 0;
  while (scanned < LEAD_EMAIL_JSON_FALLBACK_MAX_ROWS) {
    let q = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, crm_response, filters_snapshot')
      .order('created_at', { ascending: false });
    if (bancaId) q = q.eq('banca_id', bancaId);
    else if (gerenteBancaIds && gerenteBancaIds.length > 0) q = q.in('banca_id', gerenteBancaIds);
    q = q.range(offset, offset + LEAD_EMAIL_JSON_FALLBACK_PAGE - 1);
    const { data, error } = await q;
    if (error) {
      console.warn(`${LOG_PREFIX} lead_email fallback JSON scan:`, error.message ?? error);
      break;
    }
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const id = (row as { id?: string }).id;
      if (!id) continue;
      const cr = (row as { crm_response?: unknown }).crm_response;
      const fs = (row as { filters_snapshot?: unknown }).filters_snapshot;
      const hay = `${JSON.stringify(cr ?? '')}${JSON.stringify(fs ?? '')}`.toLowerCase();
      if (hay.includes(norm)) found.add(id);
    }
    scanned += rows.length;
    if (rows.length < LEAD_EMAIL_JSON_FALLBACK_PAGE) break;
    offset += LEAD_EMAIL_JSON_FALLBACK_PAGE;
  }
  return [...found];
}

/**
 * Localiza transferências por e-mail do lead:
 * (A) crm_leads.email → external_id → entries.lead_id (+ eq exato quando for e-mail completo)
 * (B) admin_lead_transfer_entries.lead_email (+ eq exato)
 * (C) texto do e-mail em crm_response / filters_snapshot dos logs (legado)
 */
async function resolveTransferLogIdsByLeadEmail(
  rawEmailQuery: string,
  bancaId: string | null,
  gerenteBancaIds: string[] | null
): Promise<'skip' | string[]> {
  const norm = normalizeLeadEmailSearchTerm(rawEmailQuery);

  if (norm.length < 3) {
    return 'skip';
  }

  const logIds = new Set<string>();

  /** --- Path A: crm_leads → entries.lead_id --- */
  const externalIds = new Set<string>();

  const { data: leadsRows, error: leadsErr } = await supabaseServiceRole
    .from('crm_leads')
    .select('external_id')
    .ilike('email', `%${norm}%`)
    .limit(8000);

  if (!leadsErr && Array.isArray(leadsRows)) {
    for (const r of leadsRows as { external_id?: number | string | null }[]) {
      const id = String(r.external_id ?? '').trim();
      if (id) externalIds.add(id);
    }
  }

  const leadIdStrings = [...externalIds];
  for (const chunk of chunkArray(leadIdStrings, IN_BATCH_SIZE)) {
    let q = supabaseServiceRole.from('admin_lead_transfer_entries').select('transfer_log_id').in('lead_id', chunk);
    if (bancaId) q = q.eq('banca_id', bancaId);
    else if (gerenteBancaIds && gerenteBancaIds.length > 0) q = q.in('banca_id', gerenteBancaIds);
    const { data, error } = await q;
    if (error) {
      console.error(`${LOG_PREFIX} lead_email path A entries by lead_id:`, error);
      continue;
    }
    for (const row of Array.isArray(data) ? data : []) {
      const id = (row as { transfer_log_id?: string }).transfer_log_id;
      if (id) logIds.add(id);
    }
  }

  /** --- Path B: admin_lead_transfer_entries.lead_email (substring; preserva `@` e pontos do termo) --- */
  const EB_PAGE = 1000;
  let ebOffset = 0;
  let pathBPending = true;
  while (pathBPending) {
    let qb = supabaseServiceRole.from('admin_lead_transfer_entries').select('transfer_log_id').ilike('lead_email', `%${norm}%`);
    if (bancaId) qb = qb.eq('banca_id', bancaId);
    else if (gerenteBancaIds && gerenteBancaIds.length > 0) qb = qb.in('banca_id', gerenteBancaIds);
    const { data: ebRows, error: ebErr } = await qb.range(ebOffset, ebOffset + EB_PAGE - 1);
    if (ebErr) {
      if (ebErr.code === 'PGRST204' || (ebErr.message ?? '').includes('lead_email')) {
        console.warn(`${LOG_PREFIX} lead_email: coluna lead_email ausente — rode migration lead_email nas entries`);
      } else {
        console.error(`${LOG_PREFIX} lead_email path B:`, ebErr);
      }
      pathBPending = false;
      break;
    }
    const rows = Array.isArray(ebRows) ? ebRows : [];
    for (const row of rows) {
      const id = (row as { transfer_log_id?: string }).transfer_log_id;
      if (id) logIds.add(id);
    }
    if (rows.length < EB_PAGE) pathBPending = false;
    else ebOffset += EB_PAGE;
  }

  /** --- Path C: JSON nos logs (legado / e-mail só no payload da transferência) --- */
  if (logIds.size === 0) {
    const fromJson = await collectTransferLogIdsFromLogsJsonEmailFallback(norm, bancaId, gerenteBancaIds);
    for (const id of fromJson) logIds.add(id);
  }

  if (logIds.size === 0) {
    return [];
  }

  return [...logIds];
}

/** Tipo da linha retornada pelo select em admin_lead_transfer_logs (evita GenericStringError do Supabase). */
type TransferLogRow = {
  id: string;
  banca_id?: string | null;
  performed_by_user_id?: string | null;
  source_consultant_email?: string | null;
  target_consultant_email?: string | null;
  leads_ids?: unknown;
  count?: number | null;
  transfer_type?: string | null;
  deadline_days?: number | null;
  devolvido_at?: string | null;
  filters_snapshot?: unknown;
  crm_response?: unknown;
  created_at?: string | null;
  transfer_kind?: 'standard' | 'admin_to_gerente_stock' | 'gerente_stock_to_consultant' | string | null;
};
/**
 * GET /api/admin/crm/transfer-logs
 * Retorna TODAS as transferências do banco (paginação interna até acabar).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, userId } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const transferType = searchParams.get('transfer_type')?.trim() || null;
    const targetConsultant = searchParams.get('target_consultant_email')?.trim() || null;
    const sourceConsultant = searchParams.get('source_consultant_email')?.trim() || null;
    const transferKind = searchParams.get('transfer_kind')?.trim() || null;
    const leadEmailQuery = searchParams.get('lead_email')?.trim() ?? '';
    // Período (from/to) não é aplicado aqui: a API retorna sempre todas as transferências do escopo.
    // O frontend filtra por data em memória (managementFrom/managementTo).

    let gerenteBancaIds: string[] | null = null;
    if (profile.status === 'gerente') {
      gerenteBancaIds = await getGerenteUserBancaIds(userId);
      if (gerenteBancaIds.length === 0) {
        return successResponse([]);
      }
      if (bancaId && !gerenteBancaIds.includes(bancaId)) {
        return errorResponse('Sem permissão para esta banca.', 403);
      }
    }

    /** Quando definido, limita aos logs que contêm um lead com e-mail encontrado em crm_leads. */
    let restrictLogIds: string[] | null = null;
    if (leadEmailQuery.length > 0) {
      console.info(`${LOG_PREFIX} GET filtro lead_email ativo`, {
        userId,
        profileStatus: profile.status,
        lead_email_len: leadEmailQuery.length,
        banca_id: bancaId,
      });
      const resolved = await resolveTransferLogIdsByLeadEmail(leadEmailQuery, bancaId, gerenteBancaIds);
      if (resolved === 'skip') {
        restrictLogIds = null;
        console.info(`${LOG_PREFIX} GET lead_email não restringe lista (skip)`);
      } else if (resolved.length === 0) {
        console.info(`${LOG_PREFIX} GET lead_email → 0 transferências (sem match crm_leads/entries)`);
        return successResponse([]);
      } else {
        restrictLogIds = resolved;
        console.info(`${LOG_PREFIX} GET lead_email → ${resolved.length} transfer_log_id(s) candidatos antes dos filtros TF/consultor`);
      }
    }

    const allLogs: TransferLogRow[] = [];

    const appendLogsQuery = (base: any): any => {
      let q = base;
      if (bancaId) q = q.eq('banca_id', bancaId);
      else if (gerenteBancaIds) q = q.in('banca_id', gerenteBancaIds);
      if (transferType && ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType)) q = q.eq('transfer_type', transferType);
      if (targetConsultant) q = q.ilike('target_consultant_email', targetConsultant);
      if (sourceConsultant) q = q.ilike('source_consultant_email', sourceConsultant);
      if (
        transferKind &&
        ['standard', 'admin_to_gerente_stock', 'gerente_stock_to_consultant'].includes(transferKind)
      ) {
        q = q.eq('transfer_kind', transferKind);
      }
      if (gerenteLeadTransferOwnActionsOnly(profile)) {
        q = q.eq('performed_by_user_id', userId);
      }
      return q;
    };

    if (restrictLogIds && restrictLogIds.length > 0) {
      const uniqueIds = [...new Set(restrictLogIds)];
      /** PostgREST limita praticamente o operador IN (~100 linhas por request é seguro). */
      const ID_CHUNK = 100;
      for (const idChunk of chunkArray(uniqueIds, ID_CHUNK)) {
        let q = appendLogsQuery(
          supabaseServiceRole.from('admin_lead_transfer_logs').select('*').in('id', idChunk).order('created_at', {
            ascending: false,
          })
        );
        const { data: logs, error } = await q;
        if (error) {
          console.error(`${LOG_PREFIX} GET error (by lead email):`, error);
          return errorResponse('Erro ao buscar logs de transferência.');
        }
        const rows = (Array.isArray(logs) ? logs : []) as TransferLogRow[];
        allLogs.push(...rows);
      }
      allLogs.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      let offset = 0;
      for (let i = 0; i < LOGS_MAX_PAGES; i++) {
        let q = appendLogsQuery(
          supabaseServiceRole
            .from('admin_lead_transfer_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + LOGS_PAGE_SIZE - 1)
        );
        const { data: logs, error } = await q;
        if (error) {
          console.error(`${LOG_PREFIX} GET error:`, error);
          return errorResponse('Erro ao buscar logs de transferência.');
        }
        const rows = (Array.isArray(logs) ? logs : []) as TransferLogRow[];
        allLogs.push(...rows);
        if (rows.length === 0) break;
        offset += rows.length;
      }
    }

    const list = allLogs;
    if (leadEmailQuery.length > 0) {
      console.info(`${LOG_PREFIX} GET resultado final com lead_email`, {
        logsRetornados: list.length,
        apos_filtros_consultor_tf: !!(transferType || targetConsultant || sourceConsultant || transferKind),
      });
    }
    if (list.length === 0) {
      return successResponse([]);
    }

    const logIds = list.map((r) => r.id);
    type EntryRow = {
      transfer_log_id: string;
      saldo_snapshot?: number | null;
      resolution_status?: string | null;
      stock_status?: 'em_estoque' | 'repassado' | 'cancelado' | string | null;
    };
    const allEntries: EntryRow[] = [];
    for (const chunk of chunkArray(logIds, IN_BATCH_SIZE)) {
      let entOffset = 0;
      while (true) {
        const { data } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('transfer_log_id, saldo_snapshot, resolution_status, stock_status')
          .in('transfer_log_id', chunk)
          .range(entOffset, entOffset + ENTRIES_PAGE_SIZE - 1);
        const rows = Array.isArray(data) ? (data as EntryRow[]) : [];
        allEntries.push(...rows);
        if (rows.length < ENTRIES_PAGE_SIZE) break;
        entOffset += ENTRIES_PAGE_SIZE;
      }
    }

    const totalBalanceByLogId = new Map<string, number>();
    const resolutionByLogId = new Map<string, { hasPending: boolean; total: number; vinculado: number; disponivel: number }>();
    const stockByLogId = new Map<string, { total: number; em_estoque: number; repassado: number; cancelado: number; revertido: number }>();
    allEntries.forEach((e: EntryRow) => {
      const current = totalBalanceByLogId.get(e.transfer_log_id) ?? 0;
      const saldo = e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0;
      totalBalanceByLogId.set(e.transfer_log_id, current + saldo);
      const res = resolutionByLogId.get(e.transfer_log_id) ?? { hasPending: false, total: 0, vinculado: 0, disponivel: 0 };
      res.total += 1;
      if (e.resolution_status === 'pending') res.hasPending = true;
      else if (e.resolution_status === 'vinculado') res.vinculado += 1;
      else if (e.resolution_status === 'disponivel_retransferencia') res.disponivel += 1;
      resolutionByLogId.set(e.transfer_log_id, res);

      const stock = stockByLogId.get(e.transfer_log_id) ?? { total: 0, em_estoque: 0, repassado: 0, cancelado: 0, revertido: 0 };
      stock.total += 1;
      if (e.stock_status === 'em_estoque') stock.em_estoque += 1;
      else if (e.stock_status === 'repassado') stock.repassado += 1;
      else if (e.stock_status === 'cancelado') stock.cancelado += 1;
      else if (e.stock_status === 'revertido') stock.revertido += 1;
      stockByLogId.set(e.transfer_log_id, stock);
    });

    const storedTotalByLogId = new Map<string, number>();
    for (const chunk of chunkArray(logIds, IN_BATCH_SIZE)) {
      const { data: logsWithTotal, error: totalErr } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, total_balance_snapshot')
        .in('id', chunk);
      if (!totalErr && Array.isArray(logsWithTotal)) {
        logsWithTotal.forEach((row: { id: string; total_balance_snapshot?: number | null }) => {
          if (row.total_balance_snapshot != null) {
            storedTotalByLogId.set(row.id, Number(row.total_balance_snapshot));
          }
        });
      }
      if (totalErr?.code === 'PGRST204') {
        console.warn(`${LOG_PREFIX} Coluna total_balance_snapshot não existe. Use a soma das entries. Execute add_total_balance_snapshot_to_transfer_logs.sql no Supabase.`);
      }
    }

    const emailsLower = new Set<string>();
    const performedByUserIds = new Set<string>();
    list.forEach((log) => {
      const s = (log.source_consultant_email ?? '').trim().toLowerCase();
      const t = (log.target_consultant_email ?? '').trim().toLowerCase();
      if (s) emailsLower.add(s);
      if (t) emailsLower.add(t);
      const pid = (log.performed_by_user_id ?? '').trim();
      if (pid) performedByUserIds.add(pid);
    });
    const emailToName = new Map<string, string>();
    if (emailsLower.size > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('email, full_name')
        .not('email', 'is', null);
      (profiles ?? []).forEach((p: { email: string | null; full_name: string | null }) => {
        const email = (p.email ?? '').trim().toLowerCase();
        if (email && emailsLower.has(email)) {
          const name = (p.full_name ?? p.email ?? '').trim();
          emailToName.set(email, name || email);
        }
      });
    }
    // performed_by_user_id -> full_name da tabela profiles (quem fez a transferência)
    const performedByName = new Map<string, string>();
    if (performedByUserIds.size > 0) {
      const { data: performerProfiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', Array.from(performedByUserIds));
      (performerProfiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
        const displayName = (p.full_name && p.full_name.trim()) ? p.full_name.trim() : (p.email && p.email.trim()) ? p.email.trim() : '-';
        performedByName.set(p.id, displayName);
      });
    }

    const DEFAULT_DEADLINE = 10;
    const enriched = list.map((log) => {
      const sourceEmail = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmail = (log.target_consultant_email ?? '').trim().toLowerCase();
      const storedTotal = storedTotalByLogId.get(log.id) ?? null;
      const totalBalance = storedTotal ?? totalBalanceByLogId.get(log.id) ?? 0;
      const performedBy = (log.performed_by_user_id ?? '').trim();
      const deadlineDays = log.deadline_days != null ? log.deadline_days : DEFAULT_DEADLINE;
      const expired = isTransferExpired(log.created_at, deadlineDays);
      const resInfo = resolutionByLogId.get(log.id);
      const stockInfo = stockByLogId.get(log.id) ?? { total: 0, em_estoque: 0, repassado: 0, cancelado: 0, revertido: 0 };
      let resolution_status_log: 'no_prazo' | 'expirada' | 'resolvida' = 'no_prazo';
      if (expired) {
        resolution_status_log = resInfo?.hasPending ? 'expirada' : 'resolvida';
      }
      let stock_status_log:
        | 'none'
        | 'em_estoque'
        | 'repassado'
        | 'cancelado_parcial'
        | 'cancelado_total'
        | 'revertido_total'
        | 'revertido_parcial' = 'none';
      if ((log.transfer_kind ?? 'standard') === 'admin_to_gerente_stock') {
        if (stockInfo.em_estoque > 0) {
          stock_status_log = 'em_estoque';
        } else if (stockInfo.repassado > 0) {
          stock_status_log = 'repassado';
        } else if (stockInfo.revertido > 0 && stockInfo.cancelado === 0 && stockInfo.repassado === 0 && stockInfo.em_estoque === 0) {
          stock_status_log = 'revertido_total';
        } else if (stockInfo.revertido > 0) {
          stock_status_log = 'revertido_parcial';
        } else if (stockInfo.cancelado > 0 && stockInfo.em_estoque === 0 && stockInfo.repassado === 0) {
          stock_status_log = 'cancelado_total';
        } else if (stockInfo.cancelado > 0) {
          stock_status_log = 'cancelado_parcial';
        }
      }
      const resInfoFull = resolutionByLogId.get(log.id);
      return {
        ...log,
        deadline_days: deadlineDays,
        total_balance_snapshot: totalBalance,
        source_consultant_name: sourceEmail ? (emailToName.get(sourceEmail) || log.source_consultant_email) : (log.source_consultant_email ?? '-'),
        target_consultant_name: targetEmail ? (emailToName.get(targetEmail) || log.target_consultant_email) : (log.target_consultant_email ?? '-'),
        performed_by_name: performedBy ? (performedByName.get(performedBy) || '-') : '-',
        resolution_status_log,
        stock_status_log,
        stock_total_count: stockInfo.total,
        stock_pending_count: stockInfo.em_estoque,
        stock_repassado_count: stockInfo.repassado,
        stock_cancelado_count: stockInfo.cancelado,
        stock_revertido_count: stockInfo.revertido,
        vinculado_count: resInfoFull?.vinculado ?? 0,
        disponivel_count: resInfoFull?.disponivel ?? 0,
      };
    });

    return successResponse(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
