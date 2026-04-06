/**
 * GET /api/admin/crm/transfer-logs/resolved-stats
 *
 * Utiliza a RPC get_resolved_transfer_stats (mesma lógica do SQL de verificação no Supabase).
 * Assim o sistema exibe os mesmos valores que a query direta no Supabase.
 *
 * Query: banca_id?, from?, to?, source_consultant_email? (consultor doador).
 * Retorno: total_resolved_logs, total_disponivel, total_vinculado, total_lucro_realizado, total_aposta_realizado,
 * total_depositado_antes, total_depositado_depois, by_type.
 *
 * Requer migration: migrations/add_get_resolved_transfer_stats_rpc.sql
 */

import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveLeadTransferQueryBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const EMPTY_RESPONSE = {
  total_resolved_logs: 0,
  total_disponivel: 0,
  total_vinculado: 0,
  total_lucro_realizado: 0,
  total_aposta_realizado: 0,
  total_depositado_antes: 0,
  total_depositado_depois: 0,
  by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
};

/**
 * Count de leads vinculados: resolution_status = 'vinculado', período em resolved_at.
 * Mantido na API pois usa resolved_at (período de resolução), não apenas logs resolvidos.
 */
async function countLeadsVinculados(
  bancaIds: string[],
  fromParam: string | null,
  toParam: string | null,
  sourceConsultantEmail: string | null
): Promise<number> {
  let transferLogIdsFilter: string[] | null = null;
  if (sourceConsultantEmail) {
    const { data: logs } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id')
      .in('banca_id', bancaIds)
      .ilike('source_consultant_email', sourceConsultantEmail);
    transferLogIdsFilter = (logs ?? []).map((r: { id: string }) => r.id);
    if (transferLogIdsFilter.length === 0) return 0;
  }

  let q = supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('id', { count: 'exact', head: true })
    .eq('resolution_status', 'vinculado')
    .in('banca_id', bancaIds)
    .not('resolved_at', 'is', null);
  if (fromParam) q = q.gte('resolved_at', dateToStartOfDaySãoPauloISO(fromParam));
  if (toParam) q = q.lte('resolved_at', dateToEndOfDaySãoPauloISO(toParam));
  if (transferLogIdsFilter?.length) q = q.in('transfer_log_id', transferLogIdsFilter);

  const { count } = await q;
  return typeof count === 'number' ? count : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;

    const scope = await resolveLeadTransferQueryBancaIds(req, userId, profile, bancaId);
    if (scope.error) return errorResponse(scope.error, 403);
    const bancaIds = scope.bancaIds;
    if (!bancaIds.length) return successResponse(EMPTY_RESPONSE);

    const [rpcResult, total_vinculado] = await Promise.all([
      supabaseServiceRole.rpc('get_resolved_transfer_stats', {
        p_banca_ids: bancaIds,
        p_from: fromParam || null,
        p_to: toParam || null,
        p_source_consultant_email: sourceConsultantEmail || null,
      }),
      countLeadsVinculados(bancaIds, fromParam, toParam, sourceConsultantEmail),
    ]);

    if (rpcResult.error) {
      console.error('[admin][transfer-logs][resolved-stats] RPC error:', rpcResult.error);
      return successResponse({ ...EMPTY_RESPONSE, total_vinculado });
    }

    const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    if (!row || typeof row !== 'object') {
      return successResponse({ ...EMPTY_RESPONSE, total_vinculado });
    }

    const r = row as {
      total_resolved_logs?: unknown;
      total_depositado_antes?: unknown;
      total_depositado_depois?: unknown;
      total_lucro_realizado?: unknown;
      total_aposta_realizado?: unknown;
      total_disponivel?: unknown;
      by_type?: unknown;
    };

    let by_type = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };
    if (r.by_type && typeof r.by_type === 'object' && !Array.isArray(r.by_type)) {
      const bt = r.by_type as Record<string, unknown>;
      by_type = {
        TF: Number(bt.TF) || 0,
        TF1: Number(bt.TF1) || 0,
        TF2: Number(bt.TF2) || 0,
        TF3: Number(bt.TF3) || 0,
      };
    }

    return successResponse({
      total_resolved_logs: Number(r.total_resolved_logs) || 0,
      total_disponivel: Number(r.total_disponivel) || 0,
      total_vinculado,
      total_lucro_realizado: Number(r.total_lucro_realizado) || 0,
      total_aposta_realizado: Number(r.total_aposta_realizado) || 0,
      total_depositado_antes: Number(r.total_depositado_antes) || 0,
      total_depositado_depois: Number(r.total_depositado_depois) || 0,
      by_type,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolved-stats] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
