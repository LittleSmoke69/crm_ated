import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-logs]';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * GET /api/admin/crm/transfer-logs
 * Lista logs de transferência de leads (auditoria).
 * Query: banca_id? (opcional), from, to, transfer_type?, target_consultant_email?, offset? (default 0), limit? (default 100, max 200) para carregamento em pacotes.
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

    const selectWithDeadline = 'id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, deadline_days, filters_snapshot, crm_response, created_at';
    const selectWithoutDeadline = 'id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, filters_snapshot, crm_response, created_at';

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
      if (msg.includes('deadline_days') || code === 'PGRST204' || msg.includes('does not exist')) {
        console.warn(`${LOG_PREFIX} Coluna deadline_days ausente; buscando sem ela. Execute add_deadline_days_to_admin_lead_transfer_logs.sql no Supabase.`);
        result = await runQuery(selectWithoutDeadline);
      }
    }
    const { data: logs, error } = result;

    if (error) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      return errorResponse('Erro ao buscar logs de transferência.');
    }

    const list = Array.isArray(logs) ? logs : [];
    if (list.length === 0) {
      return successResponse([]);
    }

    const logIds = list.map((r: { id: string }) => r.id);
    const { data: entries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, saldo_snapshot')
      .in('transfer_log_id', logIds);

    const totalBalanceByLogId = new Map<string, number>();
    (entries ?? []).forEach((e: { transfer_log_id: string; saldo_snapshot?: number | null }) => {
      const current = totalBalanceByLogId.get(e.transfer_log_id) ?? 0;
      const saldo = e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0;
      totalBalanceByLogId.set(e.transfer_log_id, current + saldo);
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
    list.forEach((log: { source_consultant_email?: string | null; target_consultant_email?: string | null; performed_by_user_id?: string | null }) => {
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

    const enriched = list.map((log: any) => {
      const sourceEmail = (log.source_consultant_email ?? '').trim().toLowerCase();
      const targetEmail = (log.target_consultant_email ?? '').trim().toLowerCase();
      const storedTotal = storedTotalByLogId.get(log.id) ?? null;
      const totalBalance = storedTotal ?? totalBalanceByLogId.get(log.id) ?? 0;
      const performedBy = (log.performed_by_user_id ?? '').trim();
      return {
        ...log,
        deadline_days: log.deadline_days != null ? log.deadline_days : 10,
        total_balance_snapshot: totalBalance,
        source_consultant_name: sourceEmail ? (emailToName.get(sourceEmail) || log.source_consultant_email) : (log.source_consultant_email ?? '-'),
        target_consultant_name: targetEmail ? (emailToName.get(targetEmail) || log.target_consultant_email) : (log.target_consultant_email ?? '-'),
        performed_by_name: performedBy ? (performedByName.get(performedBy) || '-') : '-',
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
