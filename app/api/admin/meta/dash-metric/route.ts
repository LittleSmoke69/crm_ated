/**
 * GET /api/admin/meta/dash-metric
 *
 * Métricas de uma rodada de investimento (barra de progresso de gasto + LTV do período).
 *
 * Query params (uma das duas formas):
 *   A) round_id=<uuid>                    → usa a janela/meta da rodada salva.
 *   B) consultor_id + date_from + date_to + meta_gasto  → janela ad-hoc (sem rodada salva).
 *      banca_id é resolvido do consultor se omitido.
 *
 *   include_daily_deposits=1             → inclui série diária de depósitos/LTV
 *                                          (1 chamada dashboard-metrics por dia).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { computeRoundMetric } from '@/lib/services/dashboard/investment-rounds-metric';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const includeDaily = sp.get('include_daily_deposits') === '1';

    const roundId = sp.get('round_id')?.trim() || null;

    let bancaId: string;
    let consultorId: string;
    let consultorEmail: string;
    let dateFrom: string;
    let dateTo: string;
    let metaGasto: number;
    let round: Record<string, unknown> | null = null;

    if (roundId) {
      const { data, error } = await supabaseServiceRole
        .from('meta_investment_rounds')
        .select('*')
        .eq('id', roundId)
        .maybeSingle();
      if (error) return errorResponse(error.message, 500);
      if (!data) return errorResponse('Rodada não encontrada.', 404);
      round = data;
      bancaId = String(data.banca_id);
      consultorId = String(data.consultor_id);
      consultorEmail = String(data.consultor_email);
      dateFrom = String(data.data_inicial).slice(0, 10);
      dateTo = String(data.data_final).slice(0, 10);
      metaGasto = Number(data.meta_gasto);
    } else {
      consultorId = sp.get('consultor_id')?.trim() || '';
      dateFrom = sp.get('date_from')?.trim() || '';
      dateTo = sp.get('date_to')?.trim() || '';
      metaGasto = Number(sp.get('meta_gasto'));
      bancaId = sp.get('banca_id')?.trim() || '';

      if (!consultorId) return errorResponse('round_id ou consultor_id é obrigatório.', 400);
      if (!YMD.test(dateFrom) || !YMD.test(dateTo)) {
        return errorResponse('date_from e date_to devem ser YYYY-MM-DD.', 400);
      }
      if (dateTo < dateFrom) return errorResponse('date_to não pode ser anterior a date_from.', 400);
      if (!Number.isFinite(metaGasto) || metaGasto <= 0) {
        return errorResponse('meta_gasto deve ser maior que zero.', 400);
      }

      const { data: profile, error: profErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, email')
        .eq('id', consultorId)
        .maybeSingle();
      if (profErr) return errorResponse(profErr.message, 500);
      if (!profile?.email) return errorResponse('Consultor não encontrado ou sem email.', 400);
      consultorEmail = profile.email;

      if (!bancaId) {
        const { data: ub } = await supabaseServiceRole
          .from('user_bancas')
          .select('banca_id')
          .eq('user_id', consultorId)
          .limit(1)
          .maybeSingle();
        bancaId = String((ub as { banca_id?: string } | null)?.banca_id ?? '').trim();
      }
      if (!bancaId) return errorResponse('Não foi possível resolver a banca do consultor; informe banca_id.', 400);
    }

    const result = await computeRoundMetric({
      bancaId,
      consultorId,
      consultorEmail,
      dateFrom,
      dateTo,
      metaGasto,
      includeDailyDeposits: includeDaily,
    });

    return successResponse({ round, ...result });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
