/**
 * GET /api/admin/meta/data - Lista campanhas, adsets e insights sincronizados
 * Query: banca_id (UUID) - obrigatório
 * Query opcional: date_from, date_to (YYYY-MM-DD) — filtra apenas meta_insights_daily (granularidade diária)
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }
    const dateFrom = req.nextUrl.searchParams.get('date_from');
    const dateTo = req.nextUrl.searchParams.get('date_to');

    let insightsQuery = supabaseServiceRole
      .from('meta_insights_daily')
      .select('*')
      .eq('banca_id', bancaId)
      .order('date', { ascending: false });
    if (dateFrom) insightsQuery = insightsQuery.gte('date', dateFrom);
    if (dateTo) insightsQuery = insightsQuery.lte('date', dateTo);
    insightsQuery = insightsQuery.limit(2000);

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
      insightsQuery,
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

    const camp0 = (campaignsRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const ad0 = (adsetsRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const ins0 = (insightsRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const campaignsN = campaignsRes.data?.length ?? 0;
    const adsetsN = adsetsRes.data?.length ?? 0;
    const insightsN = insightsRes.data?.length ?? 0;
    console.log('[admin/meta API] GET data resposta (dados locais pós-sync, não chama Meta)', {
      banca_id: bancaId,
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      campaigns_n: campaignsN,
      adsets_n: adsetsN,
      insights_n: insightsN,
      first_campaign_keys: camp0 ? Object.keys(camp0) : [],
      first_adset_keys: ad0 ? Object.keys(ad0) : [],
      first_insight_keys: ins0 ? Object.keys(ins0) : [],
      first_insight_head: ins0
        ? {
            date: ins0.date ?? ins0.date_start ?? null,
            campaign_id: ins0.campaign_id ?? null,
            spend: ins0.spend ?? null,
            impressions: ins0.impressions ?? null,
          }
        : null,
    });

    return successResponse({
      campaigns: campaignsRes.data ?? [],
      adsets: adsetsRes.data ?? [],
      insights: insightsRes.data ?? [],
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
