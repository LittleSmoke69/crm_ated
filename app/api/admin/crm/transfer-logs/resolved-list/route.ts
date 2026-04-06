/**
 * GET /api/admin/crm/transfer-logs/resolved-list
 *
 * Lista transferências já resolvidas no banco com leads disponíveis para mover (sem filtro de período).
 * Query: banca_id? (opcional), source_consultant_email? (consultor doador). Retorna todas as transferências resolvidas das bancas permitidas.
 * Retorno: Array<{ log_id, banca_id, transfer_type, disponivel, source_consultant_email, target_consultant_email, source_consultant_name? }>
 */

import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveLeadTransferQueryBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;
const IN_BATCH_SIZE = 150;
/** Linhas por página ao paginar entries — evita o limite padrão de 1000 do cliente Supabase. */
const ENTRIES_PAGE_SIZE = 1000;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;

    const scope = await resolveLeadTransferQueryBancaIds(req, userId, profile, bancaId);
    if (scope.error) return errorResponse(scope.error, 403);
    const bancaIds = scope.bancaIds;
    if (!bancaIds.length) return successResponse([]);

    let logsQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days, transfer_type, source_consultant_email, target_consultant_email')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: false });
    if (sourceConsultantEmail) logsQuery = logsQuery.ilike('source_consultant_email', sourceConsultantEmail);
    const { data: logs, error: logsError } = await logsQuery;

    if (logsError || !logs?.length) return successResponse([]);

    type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null; transfer_type?: string | null; source_consultant_email?: string | null; target_consultant_email?: string | null };
    const expiredLogs = (logs as LogRow[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );

    if (expiredLogs.length === 0) return successResponse([]);

    const logIds = expiredLogs.map((l) => l.id);

    /**
     * Busca apenas entries com disponivel_retransferencia usando paginação explícita.
     * O cliente Supabase retorna no máximo 1000 linhas por query por padrão; sem paginação
     * a query truncava os resultados antes de chegar nas entries disponíveis, causando
     * o modal "Mover leads" vazio mesmo com dados no dashboard.
     */
    const disponivelByLogId = new Map<string, number>();
    for (const chunk of chunkArray(logIds, IN_BATCH_SIZE)) {
      let offset = 0;
      while (true) {
        const { data } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('transfer_log_id')
          .in('transfer_log_id', chunk)
          .eq('resolution_status', 'disponivel_retransferencia')
          .range(offset, offset + ENTRIES_PAGE_SIZE - 1);
        if (!Array.isArray(data) || data.length === 0) break;
        for (const e of data as { transfer_log_id: string }[]) {
          disponivelByLogId.set(e.transfer_log_id, (disponivelByLogId.get(e.transfer_log_id) ?? 0) + 1);
        }
        if (data.length < ENTRIES_PAGE_SIZE) break;
        offset += ENTRIES_PAGE_SIZE;
      }
    }

    const list = expiredLogs
      .filter((log) => (disponivelByLogId.get(log.id) ?? 0) > 0)
      .map((log) => ({
        log_id: log.id,
        banca_id: log.banca_id,
        transfer_type: (log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(log.transfer_type))) ? String(log.transfer_type) : 'TF',
        disponivel: disponivelByLogId.get(log.id) ?? 0,
        source_consultant_email: (log.source_consultant_email ?? '').trim(),
        target_consultant_email: (log.target_consultant_email ?? '').trim(),
      }));

    /** Nome do consultor de origem (profiles.full_name) por e-mail, para identificação na UI */
    const uniqueSourceEmails = [...new Set(list.map((l) => l.source_consultant_email).filter(Boolean))];
    const nameByEmailLower = new Map<string, string>();
    for (const chunk of chunkArray(uniqueSourceEmails, 80)) {
      const { data: profs } = await supabaseServiceRole
        .from('profiles')
        .select('email, full_name')
        .in('email', chunk);
      for (const p of profs ?? []) {
        const em = (p.email ?? '').trim();
        const fn = (p.full_name ?? '').trim();
        if (em && fn) nameByEmailLower.set(em.toLowerCase(), fn);
      }
    }
    for (const em of uniqueSourceEmails) {
      const low = em.toLowerCase();
      if (nameByEmailLower.has(low)) continue;
      const { data: one } = await supabaseServiceRole
        .from('profiles')
        .select('email, full_name')
        .ilike('email', em)
        .limit(1)
        .maybeSingle();
      const fn = (one?.full_name ?? '').trim();
      if (fn) nameByEmailLower.set(low, fn);
    }

    const enriched = list.map((row) => ({
      ...row,
      source_consultant_name: nameByEmailLower.get(row.source_consultant_email.toLowerCase()) ?? null,
    }));

    return successResponse(enriched);
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolved-list] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
