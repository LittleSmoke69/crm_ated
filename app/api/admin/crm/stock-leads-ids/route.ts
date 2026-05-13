import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/crm/stock-leads-ids?banca_id=...&gerente_user_id=...&gerente_user_ids=id1,id2
 * - ids: estoque ativo (stock_status='em_estoque')
 * - transferidos_gerente_ids: todos os IDs que já entraram no estoque do gerente
 *   (em_estoque/repassado/revertido/cancelado)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const bancaId = String(searchParams.get('banca_id') ?? '').trim();
    const gerenteUserId = String(searchParams.get('gerente_user_id') ?? '').trim();
    const gerenteUserIdsCsv = String(searchParams.get('gerente_user_ids') ?? '').trim();
    const gerenteUserIds = [
      ...new Set(
        [
          ...gerenteUserIdsCsv
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          ...(gerenteUserId ? [gerenteUserId] : []),
        ]
      ),
    ];

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    console.log(
      `[admin][stock-leads-ids] start banca=${bancaId} gerente=${gerenteUserIds.length > 0 ? gerenteUserIds.join(',') : 'all'}`
    );

    let query = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, stock_gerente_user_id, stock_status')
      .eq('banca_id', bancaId)
      .eq('stock_status', 'em_estoque');

    if (gerenteUserIds.length > 0) query = query.in('stock_gerente_user_id', gerenteUserIds);

    const { data: activeRows, error } = await query;
    if (error) {
      console.error(`[admin][stock-leads-ids] active query error:`, error.message);
      return errorResponse(error.message || 'Erro ao buscar IDs do estoque.', 500);
    }

    let transferidosQuery = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, stock_gerente_user_id, stock_status')
      .eq('banca_id', bancaId)
      .in('stock_status', ['em_estoque', 'repassado', 'revertido', 'cancelado']);

    if (gerenteUserIds.length > 0) transferidosQuery = transferidosQuery.in('stock_gerente_user_id', gerenteUserIds);

    const { data: allStockRows, error: allErr } = await transferidosQuery;
    if (allErr) {
      console.error(`[admin][stock-leads-ids] transferred query error:`, allErr.message);
      return errorResponse(allErr.message || 'Erro ao buscar IDs transferidos ao estoque do gerente.', 500);
    }

    const ids = [...new Set((activeRows ?? []).map((row) => String(row.lead_id ?? '').trim()).filter(Boolean))];
    const transferidosGerenteIds = [
      ...new Set((allStockRows ?? []).map((row) => String(row.lead_id ?? '').trim()).filter(Boolean)),
    ];
    const gerenteIds = [
      ...new Set((allStockRows ?? []).map((row) => String(row.stock_gerente_user_id ?? '').trim()).filter(Boolean)),
    ];
    const statusCount = (allStockRows ?? []).reduce<Record<string, number>>((acc, row) => {
      const status = String(row.stock_status ?? '').trim() || 'unknown';
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `[admin][stock-leads-ids] ok banca=${bancaId} gerente=${gerenteUserIds.length > 0 ? gerenteUserIds.join(',') : 'all'} active=${ids.length} transferred_to_gerente=${transferidosGerenteIds.length} status=${JSON.stringify(statusCount)} sample_active=${ids.slice(0, 10).join(',')} sample_transferred=${transferidosGerenteIds.slice(0, 10).join(',')}`
    );

    return successResponse({
      banca_id: bancaId,
      gerente_user_id: gerenteUserId || null,
      gerente_user_ids: gerenteUserIds,
      ids,
      total_ids: ids.length,
      transferidos_gerente_ids: transferidosGerenteIds,
      transferidos_gerente_total: transferidosGerenteIds.length,
      status_count: statusCount,
      gerente_ids: gerenteIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
