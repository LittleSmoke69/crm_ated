import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-target-consultants]';

/**
 * GET /api/admin/crm/transfer-target-consultants
 * Lista consultores que receberam ao menos uma transferência (target_consultant_email) na banca no período.
 * Usado no modal de seleção de consultor (conversão) na aba Histórico.
 * Query: banca_id (obrigatório), from (YYYY-MM-DD), to (YYYY-MM-DD)
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

    let logsQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('target_consultant_email')
      .eq('banca_id', resolved.bancaId)
      .not('target_consultant_email', 'is', null);

    if (fromParam) {
      logsQuery = logsQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    }
    if (toParam) {
      logsQuery = logsQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
    }

    const { data: logs, error: logsError } = await logsQuery.limit(5000);

    if (logsError) {
      console.error(`${LOG_PREFIX} logs error:`, logsError);
      return errorResponse('Erro ao buscar consultores.');
    }

    const emailsLower = new Set<string>();
    for (const row of Array.isArray(logs) ? logs : []) {
      const raw = (row.target_consultant_email ?? '').trim();
      if (!raw) continue;
      emailsLower.add(raw.toLowerCase());
    }

    if (emailsLower.size === 0) {
      return successResponse({ consultants: [] });
    }

    const emailList = Array.from(emailsLower);
    const orFilter = emailList.map((e) => `email.ilike.${e}`).join(',');
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .or(orFilter)
      .limit(500);

    const consultants = (profiles ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => ({
      id: p.id,
      email: (p.email ?? '').trim(),
      full_name: (p.full_name ?? p.email ?? '').trim() || (p.email ?? ''),
    }));

    return successResponse({ consultants });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
