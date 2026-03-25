import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const LEAD_TYPE_LABELS: Record<string, string> = {
  registered: 'Lead apenas cadastrado',
  with_balance: 'Lead que possui saldo na banca',
  has_won: 'Lead que já ganhou na plataforma',
  has_withdrawn: 'Lead que já sacou na plataforma',
};

const DEFAULT_DEADLINE_DAYS = 10;
const PROFILE_IDS_CHUNK = 150;

function chunkIds<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * GET /api/admin/crm/lead-requests
 * Lista solicitações de leads dos gerentes (pending primeiro, depois por data).
 * Query: status=pending|approved|partial|rejected|all (default: all)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const statusFilter = req.nextUrl.searchParams.get('status')?.trim().toLowerCase() || 'all';
    const validStatuses = ['pending', 'approved', 'partial', 'rejected', 'all'];
    const effectiveStatus = validStatuses.includes(statusFilter) ? statusFilter : 'all';

    let query = supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, gerente_id, gerente_name, lead_type, consultores, status, banca_id, source_consultant_id, source_consultant_email, approved_by_user_id, approved_at, created_at, approval_snapshot, deadline_days, observations, rejection_observation')
      .order('created_at', { ascending: false });

    if (effectiveStatus !== 'all') {
      query = query.eq('status', effectiveStatus);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('[admin/crm/lead-requests] GET error:', error);
      return errorResponse('Erro ao listar solicitações.', 500);
    }

    const list = (Array.isArray(rows) ? rows : []).sort((a: { status: string; created_at: string }, b: { status: string; created_at: string }) => {
      const order: Record<string, number> = { pending: 0, partial: 1, approved: 2, rejected: 3 };
      const orderA = order[a.status] ?? 4;
      const orderB = order[b.status] ?? 4;
      if (orderA !== orderB) return orderA - orderB;
      return 0;
    });
    const bancaIds = [...new Set(list.map((r: { banca_id?: string | null }) => r.banca_id).filter(Boolean))] as string[];
    const bancaNamesById = new Map<string, string>();
    if (bancaIds.length > 0) {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .in('id', bancaIds);
      (bancas ?? []).forEach((b: { id: string; name: string | null; url: string | null }) => {
        bancaNamesById.set(b.id, (b.name ?? b.url ?? b.id).trim() || b.id);
      });
    }
    const consultorIds = new Set<string>();
    list.forEach((r: { consultores?: { consultor_id: string }[] }) => {
      (r.consultores ?? []).forEach((c: { consultor_id: string }) => consultorIds.add(c.consultor_id));
    });
    const ids = Array.from(consultorIds);
    const namesById = new Map<string, string>();
    const emailsById = new Map<string, string>();
    if (ids.length > 0) {
      for (const batch of chunkIds(ids, PROFILE_IDS_CHUNK)) {
        const { data: profiles, error: profErr } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name, email')
          .in('id', batch);
        if (profErr) {
          console.error('[admin/crm/lead-requests] profiles chunk error:', profErr);
          return errorResponse('Erro ao buscar perfis dos consultores.', 500);
        }
        (profiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
          const name = (p.full_name ?? p.email ?? '').trim() || (p.email ?? p.id);
          namesById.set(p.id, name);
          if (p.email) emailsById.set(p.id, p.email.trim());
        });
      }
    }
    const bancaIdsFromRequests = [...new Set(list.map((r: { banca_id?: string | null }) => r.banca_id).filter(Boolean))] as string[];
    const expiredAvailableByBanca = new Map<string, number>();
    if (bancaIdsFromRequests.length > 0) {
      const { data: logs } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, banca_id, created_at, deadline_days')
        .in('banca_id', bancaIdsFromRequests)
        .order('created_at', { ascending: false });
      type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null };
      const expiredLogs = (logs ?? []).filter((log: LogRow) =>
        isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
      );
      const expiredIds = expiredLogs.map((l: LogRow) => l.id);
      if (expiredIds.length > 0) {
        const { data: entries } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('transfer_log_id, resolution_status')
          .in('transfer_log_id', expiredIds);
        const pendingByLogId = new Set<string>();
        const disponivelByLogId = new Map<string, number>();
        (entries ?? []).forEach((e: { transfer_log_id: string; resolution_status?: string | null }) => {
          if (e.resolution_status === 'pending') pendingByLogId.add(e.transfer_log_id);
          if (e.resolution_status === 'disponivel_retransferencia') {
            disponivelByLogId.set(e.transfer_log_id, (disponivelByLogId.get(e.transfer_log_id) ?? 0) + 1);
          }
        });
        for (const log of expiredLogs) {
          if (pendingByLogId.has(log.id)) continue;
          const count = disponivelByLogId.get(log.id) ?? 0;
          if (count > 0) {
            expiredAvailableByBanca.set(log.banca_id, (expiredAvailableByBanca.get(log.banca_id) ?? 0) + count);
          }
        }
      }
    }

    const withLabels = list.map((r: {
      lead_type: string; banca_id?: string | null; consultores?: { consultor_id: string; quantity: number }[];
      status: string; approval_snapshot?: { total_leads_transferred?: number; leads_transferred_count?: number } | null;
    }) => {
      const types = (r.lead_type ?? '').split(',').map((t: string) => t.trim()).filter(Boolean);
      const lead_type_label = types.length > 0 ? types.map((t) => LEAD_TYPE_LABELS[t] ?? t).join(', ') : (LEAD_TYPE_LABELS[r.lead_type] ?? r.lead_type);
      const banca_name = r.banca_id ? (bancaNamesById.get(r.banca_id) ?? r.banca_id) : null;
      const totalRequested = (r.consultores ?? []).reduce((s: number, c: { quantity: number }) => s + c.quantity, 0);
      const snap = r.approval_snapshot;
      const leadsTransferred = snap?.total_leads_transferred ?? snap?.leads_transferred_count ?? 0;
      const leadsStillNeededForRequest = Math.max(0, totalRequested - leadsTransferred);
      const expiredAvailable = r.banca_id ? (expiredAvailableByBanca.get(r.banca_id) ?? 0) : 0;
      const leadsStillNeededFromExpired = Math.max(0, totalRequested - Math.min(totalRequested, expiredAvailable));
      return {
        ...r,
        lead_type_label,
        banca_name: banca_name ?? undefined,
        consultores: (r.consultores ?? []).map((c: {
          consultor_id: string;
          quantity: number;
          consultor_name?: string;
          consultor_email?: string;
        }) => {
          const fromProfileName = namesById.get(c.consultor_id);
          const fromProfileEmail = emailsById.get(c.consultor_id);
          const storedName = (c.consultor_name ?? '').trim();
          const storedEmail = (c.consultor_email ?? '').trim();
          const usableStoredName =
            storedName && storedName !== c.consultor_id && !isUuidLike(storedName) ? storedName : '';
          const consultor_name =
            fromProfileName
            || usableStoredName
            || fromProfileEmail
            || storedEmail
            || c.consultor_id;
          const consultor_email = fromProfileEmail || storedEmail || '';
          return {
            ...c,
            consultor_name,
            consultor_email,
          };
        }),
        leads_transferred: leadsTransferred,
        leads_still_needed: leadsStillNeededForRequest,
        expired_available: expiredAvailable,
        leads_still_needed_from_expired: leadsStillNeededFromExpired,
      };
    });

    return successResponse(withLabels);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err);
  }
}
