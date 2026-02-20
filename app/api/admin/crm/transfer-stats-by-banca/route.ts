import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-stats-by-banca]';

/**
 * GET /api/admin/crm/transfer-stats-by-banca
 * Retorna total de leads transferidos por banca (para gráfico de barras).
 * Query: from (YYYY-MM-DD), to (YYYY-MM-DD) opcionais.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;
    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));

    const { data: bancas } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name')
      .order('name', { ascending: true });

    const list = Array.isArray(bancas) ? bancas : [];
    const result: { banca_id: string; banca_name: string; total_leads: number }[] = [];

    for (const banca of list) {
      const resolved = await getAdminBancaId(userId, profile, banca.id);
      if (!resolved) continue;

      let logQuery = supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id')
        .eq('banca_id', banca.id);
      if (fromParam) logQuery = logQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
      if (toParam) logQuery = logQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
      const { data: logs } = await logQuery;
      const logIds = (logs ?? []).map((r: { id: string }) => r.id);
      if (logIds.length === 0) {
        result.push({ banca_id: banca.id, banca_name: (banca.name ?? banca.id) as string, total_leads: 0 });
        continue;
      }

      const { count } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('id', { count: 'exact', head: true })
        .in('transfer_log_id', logIds);

      result.push({
        banca_id: banca.id,
        banca_name: (banca.name ?? banca.id) as string,
        total_leads: typeof count === 'number' ? count : 0,
      });
    }

    return successResponse({ bancas: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
