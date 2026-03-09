import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const LOG_PREFIX = '[admin][transfer-logs]';
const DEFAULT_LIMIT = 50000;
const IN_BATCH_SIZE = 150;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
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
};
const MAX_LIMIT = 50000;

/**
 * GET /api/admin/crm/transfer-logs
 * Lista logs de transferência de leads (auditoria).
 * Query: banca_id? (opcional), from, to, transfer_type?, target_consultant_email?, offset? (default 0), limit? (default 50000, max 50000) para trazer todas.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    let bancaIds: string[];

    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) {
        return errorResponse('Banca não encontrada ou sem permissão.');
      }
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed || allowed.length === 0) {
        return successResponse([]);
      }
      bancaIds = allowed;
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const transferType = searchParams.get('transfer_type')?.trim();
    const targetConsultantEmail = searchParams.get('target_consultant_email')?.trim() || null;

    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const selectWithDeadline = 'id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, deadline_days, devolvido_at, filters_snapshot, crm_response, created_at';
    const selectWithoutDeadline = 'id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, filters_snapshot, crm_response, created_at';
    const selectWithDeadlineNoDevolvido = 'id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, deadline_days, filters_snapshot, crm_response, created_at';

    const runQuery = async (selectColumns: string) => {
      let q = supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select(selectColumns)
        .in('banca_id', bancaIds)
        .order('created_at', { ascending: false });
      if (fromParam) q = q.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
      if (toParam) q = q.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
      if (transferType && ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType)) q = q.eq('transfer_type', transferType);
      if (targetConsultantEmail) q = q.ilike('target_consultant_email', targetConsultantEmail);
      return q.range(offset, offset + limit - 1);
    };

    let result = await runQuery(selectWithDeadline);
    if (result.error) {
      const msg = (result.error as { message?: string; code?: string }).message ?? '';
      const code = (result.error as { code?: string }).code ?? '';
      if (msg.includes('devolvido_at') || msg.includes('deadline_days') || code === 'PGRST204' || msg.includes('does not exist')) {
        if (msg.includes('devolvido_at')) {
          console.warn(`${LOG_PREFIX} Coluna devolvido_at ausente; buscando sem ela. Execute add_devolvido_at_to_admin_lead_transfer_logs.sql no Supabase.`);
          result = await runQuery(selectWithDeadlineNoDevolvido);
        }
        if (result.error && ((result.error as { message?: string }).message ?? '').includes('deadline_days')) {
          console.warn(`${LOG_PREFIX} Coluna deadline_days ausente; buscando sem ela.`);
          result = await runQuery(selectWithoutDeadline);
        }
      }
    }
    const { data: logs, error } = result;

    if (error) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      return errorResponse('Erro ao buscar logs de transferência.');
    }

    const rawList = Array.isArray(logs) ? logs : [];
    if (rawList.length === 0) {
      return successResponse([]);
    }
    const list = rawList as unknown as TransferLogRow[];

    const logIds = list.map((r) => r.id);
    const MAX_ENTRIES = 500000;
    type EntryRow = { transfer_log_id: string; saldo_snapshot?: number | null; resolution_status?: string | null };
    const allEntries: EntryRow[] = [];
    for (const chunk of chunkArray(logIds, IN_BATCH_SIZE)) {
      const { data } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('transfer_log_id, saldo_snapshot, resolution_status')
        .in('transfer_log_id', chunk)
        .limit(MAX_ENTRIES);
      if (Array.isArray(data)) allEntries.push(...(data as EntryRow[]));
    }

    const totalBalanceByLogId = new Map<string, number>();
    const resolutionByLogId = new Map<string, { hasPending: boolean; total: number; vinculado: number; disponivel: number }>();
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
    });

    let storedTotalByLogId = new Map<string, number>();
    const { data: logsWithTotal, error: totalErr } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, total_balance_snapshot')
      .in('id', logIds);
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
        .not('email', 'is', null)
        .limit(2000);
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
      let resolution_status_log: 'no_prazo' | 'expirada' | 'resolvida' = 'no_prazo';
      if (expired) {
        resolution_status_log = resInfo?.hasPending ? 'expirada' : 'resolvida';
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
