/**
 * GET /api/gerente/dash-metric?round_id=
 * Métricas de uma rodada de um consultor sob o gerente (somente leitura).
 * Verifica que o consultor da rodada pertence à equipe do gerente.
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { computeRoundMetric } from '@/lib/services/dashboard/investment-rounds-metric';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['gerente', 'admin', 'super_admin'],
      'gestao_consultores'
    );

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

    const effectiveUserId = profile?.id || userId;
    const consultores = await getConsultorsByManager(effectiveUserId);
    const allowed = new Set(consultores.map((c) => String(c.id)));
    if (!allowed.has(String(round.consultor_id))) {
      return errorResponse('Rodada fora da sua equipe.', 403);
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
