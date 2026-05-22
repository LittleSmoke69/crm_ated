/**
 * GET /api/admin/meta/data - Lista campanhas, adsets e insights sincronizados
 * Query: banca_id (UUID) - obrigatório
 * Query opcional: date_from, date_to (YYYY-MM-DD) — filtra apenas meta_insights_daily (granularidade diária)
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isMetaVerboseLogEnabled } from '@/lib/utils/meta-debug-log';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }
    const dateFrom = req.nextUrl.searchParams.get('date_from');
    const dateTo = req.nextUrl.searchParams.get('date_to');

    let appliedInsightsDateFrom = dateFrom ?? null;
    let appliedInsightsDateTo = dateTo ?? null;

    function buildInsightsQuery(dFrom: string | null, dTo: string | null) {
      let insightsQuery = supabaseServiceRole
        .from('meta_insights_daily')
        .select('*')
        .eq('banca_id', bancaId)
        .order('date', { ascending: false });
      if (dFrom) insightsQuery = insightsQuery.gte('date', dFrom);
      if (dTo) insightsQuery = insightsQuery.lte('date', dTo);
      return insightsQuery.limit(2000);
    }

    const [campaignsRes, adsetsRes, insightsRes] = await Promise.all([
      supabaseServiceRole
        .from('meta_campaigns')
        .select('*')
        .eq('banca_id', bancaId)
        .order('updated_at', { ascending: false }),
      supabaseServiceRole
        .from('meta_adsets')
        .select('*')
        .eq('banca_id', bancaId)
        .order('updated_at', { ascending: false }),
      buildInsightsQuery(dateFrom, dateTo),
    ]);

    if (campaignsRes.error) {
      return errorResponse(`Erro ao buscar campanhas: ${campaignsRes.error.message}`, 500);
    }
    if (adsetsRes.error) {
      return errorResponse(`Erro ao buscar adsets: ${adsetsRes.error.message}`, 500);
    }
    if (insightsRes.error) {
      return errorResponse(`Erro ao buscar insights: ${insightsRes.error.message}`, 500);
    }

    let insightsData = insightsRes.data ?? [];
    if (
      insightsData.length === 0 &&
      dateFrom &&
      dateTo &&
      dateFrom === dateTo
    ) {
      let latestDateQuery = supabaseServiceRole
        .from('meta_insights_daily')
        .select('date')
        .eq('banca_id', bancaId)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .limit(1);
      const latestDateRes = await latestDateQuery.maybeSingle();
      const fallbackDate =
        !latestDateRes.error && latestDateRes.data?.date
          ? String(latestDateRes.data.date)
          : null;

      if (fallbackDate && fallbackDate !== dateFrom) {
        const fbRes = await buildInsightsQuery(fallbackDate, fallbackDate);
        if (!fbRes.error && (fbRes.data?.length ?? 0) > 0) {
          insightsData = fbRes.data ?? [];
          appliedInsightsDateFrom = fallbackDate;
          appliedInsightsDateTo = fallbackDate;
          if (isMetaVerboseLogEnabled()) {
            console.log('[admin/meta API] GET data fallback', {
              banca_id: bancaId,
              applied_date: fallbackDate,
              insights_n: insightsData.length,
            });
          }
        }
      }
    }

    return successResponse({
      campaigns: campaignsRes.data ?? [],
      adsets: adsetsRes.data ?? [],
      insights: insightsData,
      applied_insights_date_from: appliedInsightsDateFrom,
      applied_insights_date_to: appliedInsightsDateTo,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
