/**
 * GET /api/consultor/dash-metric?round_id=
 * Métricas (barra de progresso de gasto + LTV do período + gasto diário) de uma rodada
 * do PRÓPRIO consultor. Somente leitura. Verifica que a rodada pertence ao perfil.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { computeRoundMetric } from '@/lib/services/dashboard/investment-rounds-metric';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    if (!userId) return errorResponse('Não autenticado', 403);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);

    const roundId = req.nextUrl.searchParams.get('round_id')?.trim();
    if (!roundId) return errorResponse('round_id é obrigatório.', 400);
    const includeDaily = req.nextUrl.searchParams.get('include_daily_deposits') === '1';

    const { data: round, error } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .select('*')
      .eq('id', roundId)
      .maybeSingle();
    if (error) return errorResponse(error.message, 500);
    if (!round) return errorResponse('Rodada não encontrada.', 404);
    if (String(round.consultor_id) !== String(profile.id)) {
      return errorResponse('Esta rodada não pertence a você.', 403);
    }

    const result = await computeRoundMetric({
      bancaId: String(round.banca_id),
      consultorId: String(round.consultor_id),
      consultorEmail: String(round.consultor_email),
      dateFrom: String(round.data_inicial).slice(0, 10),
      dateTo: String(round.data_final).slice(0, 10),
      metaGasto: Number(round.meta_gasto),
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
