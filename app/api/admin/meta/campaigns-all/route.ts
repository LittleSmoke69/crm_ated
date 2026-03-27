/**
 * GET /api/admin/meta/campaigns-all
 * Lista campanhas sincronizadas (meta_campaigns) de TODAS as bancas.
 *
 * Query:
 * - limit (default 20, max 100)
 * - offset (default 0)
 * - search (opcional: banca/campanha)
 * - banca_id (opcional)
 * - active_only (default 1) - quando 1, retorna apenas campanhas ACTIVE
 * - date_from/date_to (opcional) - agrega métricas de meta_insights_daily no período
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { buildCampaignConsultorSummary } from '@/lib/services/meta-campaign-consultors';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const rawLimit = Number(sp.get('limit') ?? '20');
    const rawOffset = Number(sp.get('offset') ?? '0');
    const search = (sp.get('search') ?? '').trim();
    const bancaId = (sp.get('banca_id') ?? '').trim();
    const campaignKind = (sp.get('campaign_kind') ?? '').trim();
    const activeOnlyParam = (sp.get('active_only') ?? '1').trim();
    const activeOnly = !(activeOnlyParam === '0' || activeOnlyParam.toLowerCase() === 'false');
    const dateFrom = (sp.get('date_from') ?? '').trim();
    const dateTo = (sp.get('date_to') ?? '').trim();

    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 100);
    const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

    let q = supabaseServiceRole
      .from('meta_campaigns')
      .select(
        'banca_id,campaign_id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,updated_at,campaign_kind',
        { count: 'exact' }
      )
      .order('updated_at', { ascending: false });

    if (bancaId) q = q.eq('banca_id', bancaId);
    if (campaignKind === 'normal' || campaignKind === 'bolao') {
      q = q.eq('campaign_kind', campaignKind);
    }
    if (search) {
      // Busca simples (ilike) pelo nome da campanha
      q = q.ilike('name', `%${search}%`);
    }
    if (activeOnly) {
      // Meta usa status/effective_status. Considera ACTIVE em pelo menos um dos campos.
      q = q.or('effective_status.eq.ACTIVE,status.eq.ACTIVE');
    }

    const { data: campaigns, error, count } = await q.range(offset, offset + limit - 1);
    if (error) return errorResponse(`Erro ao buscar campanhas: ${error.message}`, 500);

    const bancaIds = Array.from(new Set((campaigns ?? []).map((c) => c.banca_id))).filter(Boolean) as string[];

    // PostgREST falha com `.in('id', [])` — comum na última página vazia (ex.: offset após o total).
    let bancaById = new Map<string, { id: string; name: string | null; url: string | null }>();
    if (bancaIds.length > 0) {
      const { data: bancas, error: bancasErr } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id,name,url')
        .in('id', bancaIds);
      if (bancasErr) return errorResponse(`Erro ao buscar bancas: ${bancasErr.message}`, 500);
      bancaById = new Map((bancas ?? []).map((b) => [b.id, b]));
    }

    const metricByKey = new Map<
      string,
      { reach: number; impressions: number; clicks: number; leads: number; spend: number }
    >();

    if ((campaigns ?? []).length > 0) {
      const bancaIdsForMetrics = Array.from(new Set((campaigns ?? []).map((c) => String(c.banca_id))));
      const campaignIdsForMetrics = Array.from(new Set((campaigns ?? []).map((c) => String(c.campaign_id))));
      let iq = supabaseServiceRole
        .from('meta_insights_daily')
        .select('banca_id,campaign_id,reach,impressions,clicks,leads,spend')
        .in('banca_id', bancaIdsForMetrics)
        .in('campaign_id', campaignIdsForMetrics);
      if (dateFrom) iq = iq.gte('date', dateFrom);
      if (dateTo) iq = iq.lte('date', dateTo);
      const { data: insightsRows, error: insightsErr } = await iq;
      if (insightsErr) return errorResponse(`Erro ao buscar métricas de campanhas: ${insightsErr.message}`, 500);
      for (const r of insightsRows ?? []) {
        const key = `${String(r.banca_id)}:${String(r.campaign_id)}`;
        const cur = metricByKey.get(key) ?? { reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 };
        cur.reach += Number(r.reach) || 0;
        cur.impressions += Number(r.impressions) || 0;
        cur.clicks += Number(r.clicks) || 0;
        cur.leads += Number(r.leads) || 0;
        cur.spend += Number(r.spend) || 0;
        metricByKey.set(key, cur);
      }
    }

    const campaignsByBanca = new Map<string, string[]>();
    (campaigns ?? []).forEach((c) => {
      const key = String(c.banca_id);
      const list = campaignsByBanca.get(key) || [];
      list.push(String(c.campaign_id));
      campaignsByBanca.set(key, list);
    });
    const consultorSummaryByBancaCampaign = new Map<string, Awaited<ReturnType<typeof buildCampaignConsultorSummary>>>();
    for (const [bancaKey, campaignIds] of campaignsByBanca.entries()) {
      const summary = await buildCampaignConsultorSummary(
        bancaKey,
        campaignIds,
        dateFrom || null,
        dateTo || null
      );
      consultorSummaryByBancaCampaign.set(bancaKey, summary);
    }

    const rows = (campaigns ?? []).map((c) => {
      const banca = bancaById.get(c.banca_id);
      const metrics = metricByKey.get(`${String(c.banca_id)}:${String(c.campaign_id)}`) ?? {
        reach: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        spend: 0,
      };
      const consultorSummary = consultorSummaryByBancaCampaign
        .get(String(c.banca_id))
        ?.get(String(c.campaign_id));
      return {
        banca_id: c.banca_id,
        banca_name: banca?.name ?? banca?.url ?? c.banca_id,
        banca_url: banca?.url ?? null,
        campaign_id: c.campaign_id,
        name: c.name ?? null,
        objective: c.objective ?? null,
        status: c.status ?? null,
        effective_status: c.effective_status ?? null,
        daily_budget: c.daily_budget ?? null,
        lifetime_budget: c.lifetime_budget ?? null,
        start_time: (c as { start_time?: string | null }).start_time ?? null,
        stop_time: (c as { stop_time?: string | null }).stop_time ?? null,
        updated_at: c.updated_at ?? null,
        campaign_kind: (c as { campaign_kind?: string }).campaign_kind ?? 'normal',
        reach: metrics.reach,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        leads: metrics.leads,
        spend: metrics.spend,
        assigned_consultors: consultorSummary?.assigned_consultors ?? [],
        consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
        consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
      };
    });

    return successResponse({
      rows,
      pagination: {
        limit,
        offset,
        total: count ?? rows.length,
      },
      filters: {
        active_only: activeOnly,
        banca_id: bancaId || null,
        search: search || null,
        campaign_kind: campaignKind || null,
        date_from: dateFrom || null,
        date_to: dateTo || null,
      },
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

