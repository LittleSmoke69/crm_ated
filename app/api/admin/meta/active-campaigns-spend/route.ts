/**
 * GET /api/admin/meta/active-campaigns-spend
 * Query: banca_id (obrigatório), integration_id?, tz? (IANA, default America/Sao_Paulo),
 *   date_preset? (ex. last_7d — opcional), since? + until?, time_increment?
 * Padrão sem período: **hoje** no calendário do `tz`, granularidade diária (time_increment=1).
 * Retorno: { campaigns, totalSpend } — Insights ativos (delivery_info).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getDecryptedToken,
  getDecryptedTokenByIntegrationId,
  getMetaConfig,
  fetchMetaBillingSnapshot,
  getMetaCurrencyForBanca,
  isMetaIntegrationLinkedToBanca,
  listMetaIntegrationsForBanca,
} from '@/lib/services/meta-sync-service';
import { getActiveCampaignsSpend, type GetActiveCampaignsSpendOptions } from '@/lib/meta/metaAdsService';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const bancaId = String(sp.get('banca_id') ?? '').trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }

    const integrationIdRaw = sp.get('integration_id');
    const integrationId =
      integrationIdRaw != null && String(integrationIdRaw).trim() !== ''
        ? String(integrationIdRaw).trim()
        : null;
    if (integrationId) {
      const linked = await isMetaIntegrationLinkedToBanca(integrationId, bancaId);
      if (!linked) return errorResponse('integration_id não pertence a esta banca.', 400);
    }

    const token = integrationId
      ? await getDecryptedTokenByIntegrationId(integrationId)
      : await getDecryptedToken(bancaId);
    if (!token) {
      return errorResponse('Token Meta não configurado para esta banca.', 400);
    }

    let baseUrl = 'https://graph.facebook.com/v25.0';
    let adAccountId: string | null = null;
    if (integrationId) {
      const list = await listMetaIntegrationsForBanca(bancaId);
      const hit = list.find((x) => String(x.id) === integrationId);
      if (!hit?.ad_account_id?.trim()) {
        return errorResponse('Integração sem ad_account_id configurado.', 400);
      }
      baseUrl = hit.base_url?.trim() || baseUrl;
      adAccountId = hit.ad_account_id.trim();
    } else {
      const row = await getMetaConfig(bancaId);
      baseUrl = row?.base_url?.trim() || baseUrl;
      adAccountId = row?.ad_account_id?.trim() ?? null;
    }
    if (!adAccountId) {
      return errorResponse('Conta de anúncios (ad_account_id) não configurada.', 400);
    }

    const datePreset = sp.get('date_preset')?.trim() || undefined;
    const since = sp.get('since')?.trim();
    const until = sp.get('until')?.trim();
    const timeRange =
      since && until
        ? {
            since,
            until,
          }
        : undefined;
    const ti = sp.get('time_increment');
    const timeIncrement = ti != null && ti !== '' ? parseInt(ti, 10) : undefined;
    const calendarTimeZone = sp.get('tz')?.trim() || undefined;

    const spendOpts: GetActiveCampaignsSpendOptions = {};
    if (datePreset) spendOpts.datePreset = datePreset;
    if (timeRange) spendOpts.timeRange = timeRange;
    if (Number.isFinite(timeIncrement as number)) spendOpts.timeIncrement = timeIncrement;
    if (calendarTimeZone) spendOpts.calendarTimeZone = calendarTimeZone;

    const cardChargesPeriod = timeRange ? { since: timeRange.since, until: timeRange.until } : null;
    const integrationCurrencyHint = await getMetaCurrencyForBanca(bancaId);
    const [report, billing] = await Promise.all([
      getActiveCampaignsSpend(baseUrl, token, adAccountId, spendOpts),
      fetchMetaBillingSnapshot(baseUrl, token, adAccountId, {
        cardChargesPeriod,
        integrationCurrencyHint,
      }),
    ]);

    return successResponse({ ...report, billing });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    if (String(err?.message ?? '').includes('Meta API')) {
      return errorResponse(err.message, 502);
    }
    return serverErrorResponse(err);
  }
}
