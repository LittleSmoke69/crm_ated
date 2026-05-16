/**
 * GET /api/admin/meta/banca-x-ads-ranking
 * Ranking diário cruzando GASTO em Meta Ads (meta_insights_daily) com as MÉTRICAS DA BANCA
 * (CRM `/api/crm/dashboard-metrics`), uma linha por banca, ordenado por gasto desc.
 *
 * Query params:
 *   - date? YYYY-MM-DD  (default: hoje em `tz`)
 *   - tz?   IANA        (default: America/Sao_Paulo)
 *   - limit? number     (apenas para testes — limita o nº de bancas processadas)
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaXAdsRanking } from '@/lib/services/banca-x-ads-ranking';

/** Agrega CRM externo por banca em paralelo — Netlify precisa de margem além do default 10s. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const date = sp.get('date')?.trim() || null;
    const tz = sp.get('tz')?.trim() || null;
    const limitParam = sp.get('limit');
    const limit = limitParam != null && limitParam !== '' ? parseInt(limitParam, 10) : null;

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse('Parâmetro `date` inválido. Use YYYY-MM-DD.', 400);
    }

    const result = await getBancaXAdsRanking({
      date,
      tz,
      limit: Number.isFinite(limit as number) ? (limit as number) : null,
    });

    return successResponse(result);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
