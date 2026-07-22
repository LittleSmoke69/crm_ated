/**
 * GET /api/gerente/investment-rounds?consultor_id=
 * Lista rodadas dos consultores sob o gerente (somente leitura). Retorna também a
 * lista de consultores (para filtro e nomes). Filtro opcional por consultor_id,
 * desde que pertença à equipe do gerente.
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['gerente', 'admin', 'super_admin'],
      'gestao_consultores'
    );

    const effectiveUserId = profile?.id || userId;
    const consultores = await getConsultorsByManager(effectiveUserId);
    const consultorIds = consultores.map((c) => String(c.id));

    const consultorFilter = req.nextUrl.searchParams.get('consultor_id')?.trim() || null;
    let idsToQuery = consultorIds;
    if (consultorFilter) {
      if (!consultorIds.includes(consultorFilter)) {
        return errorResponse('Consultor fora da sua equipe.', 403);
      }
      idsToQuery = [consultorFilter];
    }

    let rounds: any[] = [];
    if (idsToQuery.length > 0) {
      const { data, error } = await supabaseServiceRole
        .from('meta_investment_rounds')
        .select('*')
        .in('consultor_id', idsToQuery)
        .order('data_inicial', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) return errorResponse(error.message, 500);
      rounds = data ?? [];
    }

    return successResponse({
      rounds,
      consultors: consultores.map((c) => ({
        id: String(c.id),
        email: c.email ?? '',
        full_name: c.full_name ?? null,
      })),
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
