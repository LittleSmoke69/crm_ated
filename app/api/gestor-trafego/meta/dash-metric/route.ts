/**
 * GET /api/gestor-trafego/meta/dash-metric
 *
 * Igual ao admin, com escopo de banca do gestor. Aceita round_id (usa a janela salva)
 * ou janela ad-hoc (consultor_id + date_from + date_to + meta_gasto + banca_id).
 */

import { NextRequest } from 'next/server';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { gestorTrafegoUserCanAccessBanca } from '@/lib/services/gestor-trafego-bancas';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { computeRoundMetric } from '@/lib/services/dashboard/investment-rounds-metric';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireGestorTrafego(req);
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
      if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
      if (!YMD.test(dateFrom) || !YMD.test(dateTo)) {
        return errorResponse('date_from e date_to devem ser YYYY-MM-DD.', 400);
      }
      if (dateTo < dateFrom) return errorResponse('date_to não pode ser anterior a date_from.', 400);
      if (!Number.isFinite(metaGasto) || metaGasto <= 0) {
        return errorResponse('meta_gasto deve ser maior que zero.', 400);
      }

      const { data: prof, error: profErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, email')
        .eq('id', consultorId)
        .maybeSingle();
      if (profErr) return errorResponse(profErr.message, 500);
      if (!prof?.email) return errorResponse('Consultor não encontrado ou sem email.', 400);
      consultorEmail = prof.email;
    }

    if (!(await gestorTrafegoUserCanAccessBanca(userId, profile, bancaId))) {
      return errorResponse('Você não tem permissão para acessar esta banca.', 403);
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
