/**
 * GET /api/admin/meta/active-ads-bancas?date_from=&date_to=
 * IDs das bancas COM campanha ativa (spend LIVE) no período — mesmo conjunto do
 * Ranking Diário. Usado para filtrar quais cards "Análise da Banca" exibir.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getLiveAdsByRange } from '@/lib/services/dashboard/banca-analysis';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from')?.trim() || '';
    const dateTo = sp.get('date_to')?.trim() || '';
    if (!YMD.test(dateFrom) || !YMD.test(dateTo)) {
      return errorResponse('date_from e date_to devem ser YYYY-MM-DD.', 400);
    }

    const live = await getLiveAdsByRange(dateFrom, dateTo);
    const bancaIds = live ? Array.from(live.bancasWithActiveAds) : [];
    return successResponse({ banca_ids: bancaIds });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
