/**
 * GET /api/admin/meta/banca-x-ads-ranking
 * Ranking cruzando GASTO em Meta Ads (LIVE Graph) com as MÉTRICAS DA BANCA
 * (CRM `/api/crm/dashboard-metrics`), uma linha por banca, ordenado por gasto desc.
 *
 * Query params (todos opcionais):
 *   - date_from / date_to  YYYY-MM-DD  (range; default: hoje em `tz`)
 *   - date                 YYYY-MM-DD  (atalho single-day, mantido por retrocompat)
 *   - tz                   IANA        (default: America/Sao_Paulo)
 *   - limit                number      (apenas para testes — limita nº de bancas processadas)
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaXAdsRanking } from '@/lib/services/banca-x-ads-ranking';

/** Agrega CRM externo por banca em paralelo — Netlify precisa de margem além do default 10s. */
export const maxDuration = 300;
/** LIVE do Meta Graph + queries Supabase: nunca cachear, sempre renderizar fresh. */
export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const date = sp.get('date')?.trim() || null;
    const dateFrom = sp.get('date_from')?.trim() || null;
    const dateTo = sp.get('date_to')?.trim() || null;
    const tz = sp.get('tz')?.trim() || null;
    const limitParam = sp.get('limit');
    const limit = limitParam != null && limitParam !== '' ? parseInt(limitParam, 10) : null;

    for (const [name, value] of [
      ['date', date],
      ['date_from', dateFrom],
      ['date_to', dateTo],
    ] as const) {
      if (value && !YMD.test(value)) {
        return errorResponse(`Parâmetro \`${name}\` inválido. Use YYYY-MM-DD.`, 400);
      }
    }

    const result = await getBancaXAdsRanking({
      date,
      dateFrom,
      dateTo,
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
