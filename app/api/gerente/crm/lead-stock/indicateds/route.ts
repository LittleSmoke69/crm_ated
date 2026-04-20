import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[gerente][lead-stock][indicateds]';

/**
 * GET /api/gerente/crm/lead-stock/indicateds?banca_id=&deadline_days=all|10|20|30|other
 * Lista agregada (retrocompatível) dos leads reservados no estoque lógico do gerente.
 * Os dados vêm dos snapshots gravados no momento da reserva admin→estoque — sem consulta ao CRM.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const { searchParams } = req.nextUrl;
    const bancaId = searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);

    const deadlineParam = (searchParams.get('deadline_days')?.trim().toLowerCase() ?? 'all') as string;
    const allowed = new Set(['all', '10', '20', '30', 'other']);
    const deadlineBucket = allowed.has(deadlineParam) ? deadlineParam : 'all';

    const { data: entries, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select(
        'lead_id, transfer_log_id, transfer_type, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot, created_at, stock_status, original_source_consultant_email'
      )
      .eq('banca_id', bancaId)
      .eq('stock_gerente_user_id', userId)
      .eq('stock_status', 'em_estoque');

    if (error) {
      console.error(`${LOG_PREFIX} entries error:`, error.message);
      return errorResponse('Erro ao buscar leads do estoque.');
    }

    const rows = Array.isArray(entries) ? entries : [];
    if (rows.length === 0) {
      return successResponse({
        count: 0,
        total: 0,
        data: [],
        pagination: { current_page: 1, per_page: rows.length, total: 0, last_page: 1 },
        stock_meta: {
          counts: { all: 0, '10': 0, '20': 0, '30': 0, other: 0 },
          expected_in_crm: 0,
          matched_in_crm: 0,
          deadline_filter: deadlineBucket,
        },
      });
    }

    const logIds = Array.from(new Set(rows.map((r) => String(r.transfer_log_id)).filter(Boolean)));
    const { data: logs } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, deadline_days, transfer_type, created_at')
      .in('id', logIds)
      .eq('banca_id', bancaId)
      .eq('transfer_kind', 'admin_to_gerente_stock');

    const logById = new Map<string, { deadline_days: number; transfer_type: string; created_at: string }>();
    for (const l of (logs ?? []) as Array<{ id: string; deadline_days: number | null; transfer_type: string | null; created_at: string | null }>) {
      logById.set(l.id, {
        deadline_days: Number(l.deadline_days ?? 10) || 10,
        transfer_type: String(l.transfer_type ?? 'TF'),
        created_at: String(l.created_at ?? new Date().toISOString()),
      });
    }

    function bucket(days: number): 'all' | '10' | '20' | '30' | 'other' {
      if (days === 10) return '10';
      if (days === 20) return '20';
      if (days === 30) return '30';
      return 'other';
    }
    const counts = { all: 0, '10': 0, '20': 0, '30': 0, other: 0 };

    const enriched = rows
      .map((e) => {
        const log = logById.get(String(e.transfer_log_id));
        if (!log) return null;
        const deadline_days = log.deadline_days;
        counts.all++;
        counts[bucket(deadline_days)]++;
        return {
          id: e.lead_id,
          name: e.lead_name ?? null,
          phone: e.lead_phone ?? null,
          balance: e.saldo_snapshot,
          last_interaction: e.last_interaction_snapshot,
          total_depositado: e.total_depositado_snapshot,
          total_apostado: e.total_apostado_snapshot,
          total_ganho: e.total_ganho_snapshot,
          available_withdraw: e.available_withdraw_snapshot,
          total_saque: e.total_saque_snapshot,
          original_source_consultant_email: e.original_source_consultant_email,
          stock_meta: {
            lead_id: String(e.lead_id),
            deadline_days,
            transfer_type: log.transfer_type,
            received_at: log.created_at,
            transfer_log_id: String(e.transfer_log_id),
          },
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    const filtered =
      deadlineBucket === 'all'
        ? enriched
        : enriched.filter((row) => {
            const sm = (row as { stock_meta?: { deadline_days?: number } }).stock_meta;
            return sm?.deadline_days != null && bucket(Number(sm.deadline_days)) === deadlineBucket;
          });

    return successResponse({
      count: filtered.length,
      total: filtered.length,
      data: filtered,
      pagination: { current_page: 1, per_page: filtered.length, total: filtered.length, last_page: 1 },
      stock_meta: {
        counts,
        expected_in_crm: enriched.length,
        matched_in_crm: enriched.length,
        deadline_filter: deadlineBucket,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    console.error(LOG_PREFIX, err);
    return serverErrorResponse(err);
  }
}
