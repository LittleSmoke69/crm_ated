import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const LOG_PREFIX = '[admin][transfer-logs]';

/** Normaliza string de data para YYYY-MM-DD (aceita YYYY-MM-DD ou DD/MM/YYYY). */
function normalizeDateParam(value: string | null | undefined): string | null {
  const s = value?.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ddmmyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyy) return `${ddmmyy[3]}-${ddmmyy[2].padStart(2, '0')}-${ddmmyy[1].padStart(2, '0')}`;
  return null;
}

/**
 * GET /api/admin/crm/transfer-logs
 * Lista logs de transferência de leads (auditoria).
 * Query: banca_id (obrigatório), from (YYYY-MM-DD), to (YYYY-MM-DD), transfer_type (TF|TF1|TF2|TF3), target_consultant_email? (filtrar por consultor destino)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const transferType = searchParams.get('transfer_type')?.trim();
    const targetConsultantEmail = searchParams.get('target_consultant_email')?.trim() || null;

    let query = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, performed_by_user_id, source_consultant_email, target_consultant_email, leads_ids, count, transfer_type, filters_snapshot, crm_response, created_at')
      .eq('banca_id', resolved.bancaId)
      .order('created_at', { ascending: false });

    if (fromParam) {
      query = query.gte('created_at', `${fromParam}T00:00:00.000Z`);
    }
    if (toParam) {
      query = query.lte('created_at', `${toParam}T23:59:59.999Z`);
    }
    if (transferType && ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType)) {
      query = query.eq('transfer_type', transferType);
    }
    if (targetConsultantEmail) {
      query = query.ilike('target_consultant_email', targetConsultantEmail);
    }

    const { data: logs, error } = await query.limit(500);

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
