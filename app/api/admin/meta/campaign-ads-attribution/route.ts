/**
 * POST /api/admin/meta/campaign-ads-attribution
 * Define quais consultores recebem o spend Meta desta campanha no card Meu Desempenho (Ads Meta/Redirect).
 * Body: { banca_id, campaign_id, ads_attribution_consultor_ids?: string[] | null, ads_attribution_consultor_id?: string | null (legado), name? }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isConsultorAllowedForAdsAttribution } from '@/lib/services/meta-campaign-consultors';

function normalizeAdsAttributionConsultorIds(body: Record<string, unknown>): string[] {
  const rawArr = body?.ads_attribution_consultor_ids;
  if (Array.isArray(rawArr)) {
    return Array.from(
      new Set(
        rawArr.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0)
      )
    );
  }
  const rawAttr = body?.ads_attribution_consultor_id;
  if (rawAttr == null || String(rawAttr).trim() === '') return [];
  return [String(rawAttr).trim()];
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as Record<string, unknown>;
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const ids = normalizeAdsAttributionConsultorIds(body);

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }

    for (const consultorId of ids) {
      const allowed = await isConsultorAllowedForAdsAttribution(bancaId, consultorId);
      if (!allowed) {
        return errorResponse(
          'Cada perfil marcado precisa estar na rede desta banca (user_bancas ou hierarquia enroller): consultor, gerente, admin, gestor ou super_admin.',
          400
        );
      }
    }

    const nameRaw = body?.name;
    const name =
      nameRaw != null && String(nameRaw).trim() !== '' ? String(nameRaw).trim().slice(0, 2000) : null;

    const now = new Date().toISOString();
    const adsAttributionConsultorIdsPayload = ids.length > 0 ? ids : null;
    const adsAttributionConsultorIdLegacy = ids.length > 0 ? ids[0] : null;

    const rowPayload = {
      ads_attribution_consultor_ids: adsAttributionConsultorIdsPayload,
      ads_attribution_consultor_id: adsAttributionConsultorIdLegacy,
      updated_at: now,
    };

    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update(rowPayload)
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,ads_attribution_consultor_id,ads_attribution_consultor_ids')
      .maybeSingle();

    if (upErr) {
      const msg = String(upErr.message ?? '').toLowerCase();
      if (upErr.code === '42703' || msg.includes('ads_attribution_consultor')) {
        return errorResponse(
          'Migração pendente: aplique supabase/migrations/20260508120000_meta_campaigns_ads_attribution_consultor.sql e 20260509100000_meta_campaigns_ads_attribution_consultor_ids.sql.',
          500
        );
      }
      return errorResponse(upErr.message, 500);
    }
    if (updated) {
      return successResponse({ row: updated });
    }

    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .insert({
        banca_id: bancaId,
        campaign_id: campaignId,
        ...rowPayload,
        name,
      })
      .select('banca_id,campaign_id,ads_attribution_consultor_id,ads_attribution_consultor_ids')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        const { data: retry, error: retryErr } = await supabaseServiceRole
          .from('meta_campaigns')
          .update(rowPayload)
          .eq('banca_id', bancaId)
          .eq('campaign_id', campaignId)
          .select('banca_id,campaign_id,ads_attribution_consultor_id,ads_attribution_consultor_ids')
          .maybeSingle();
        if (retryErr) return errorResponse(retryErr.message, 500);
        if (retry) return successResponse({ row: retry });
      }
      const msg = String(insErr.message ?? '').toLowerCase();
      if (insErr.code === '42703' || msg.includes('ads_attribution_consultor')) {
        return errorResponse(
          'Migração pendente: aplique supabase/migrations/20260508120000_meta_campaigns_ads_attribution_consultor.sql e 20260509100000_meta_campaigns_ads_attribution_consultor_ids.sql.',
          500
        );
      }
      return errorResponse(insErr.message, 500);
    }

    return successResponse({ row: inserted });
  } catch (err: unknown) {
    const e = err as { message?: string };
    if (e?.message?.includes('Acesso negado') || e?.message?.includes('não autenticado')) {
      return errorResponse(String(e.message), 403);
    }
    return serverErrorResponse(err);
  }
}
