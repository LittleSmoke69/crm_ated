/**
 * GET /api/admin/meta/config - Retorna configuração Meta da banca (sem token)
 * PUT /api/admin/meta/config - Salva configuração Meta (criptografa token)
 * Query: banca_id (UUID) - obrigatório
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getMetaConfig,
  getMetaConfigForBancaIds,
  listMetaIntegrationsForBanca,
  upsertMetaConfig,
} from '@/lib/services/meta-sync-service';

function mapIntegrationPublic(row: {
  id: string;
  base_url: string;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  currency?: string | null;
  banca_ids?: string[];
}) {
  return {
    integration_id: row.id,
    base_url: row.base_url,
    token_last4: row.token_last4 ?? null,
    ad_account_id: row.ad_account_id,
    pixel_id: row.pixel_id,
    default_campaign_id: row.default_campaign_id,
    is_active: row.is_active,
    last_sync_at: row.last_sync_at,
    last_sync_error: row.last_sync_error,
    last_sync_date_preset: row.last_sync_date_preset,
    currency: row.currency ?? null,
    banca_ids: row.banca_ids ?? [],
  };
}

const defaultConfigPayload = {
  configured: false,
  integration_id: null as string | null,
  integrations: [] as ReturnType<typeof mapIntegrationPublic>[],
  banca_ids: [] as string[],
  base_url: 'https://graph.facebook.com/v19.0',
  token_last4: null as string | null,
  ad_account_id: null as string | null,
  pixel_id: null as string | null,
  default_campaign_id: null as string | null,
  is_active: true,
  last_sync_at: null as string | null,
  last_sync_error: null as string | null,
  last_sync_date_preset: null as string | null,
};

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    const bancaIdsRaw = req.nextUrl.searchParams.get('banca_ids');

    const idsFromQuery = bancaIdsRaw
      ? bancaIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (idsFromQuery.length > 0) {
      const resolved = await getMetaConfigForBancaIds(idsFromQuery);
      if (!resolved.ok) {
        return errorResponse(resolved.error, 400);
      }
      if (resolved.mode === 'unconfigured') {
        return successResponse({
          ...defaultConfigPayload,
          banca_ids: resolved.banca_ids,
        });
      }
      const config = resolved.row;
      const anchorBanca =
        (Array.isArray(config.banca_ids) && config.banca_ids[0]
          ? String(config.banca_ids[0])
          : String(config.banca_id || '')) || idsFromQuery[0];
      const integrationsList = anchorBanca ? await listMetaIntegrationsForBanca(anchorBanca) : [];
      const primary =
        integrationsList.find((c) => String(c.id) === String(config.id)) ?? integrationsList[0] ?? config;
      return successResponse({
        configured: true,
        integration_id: String(primary.id),
        integrations: integrationsList.map((c) => mapIntegrationPublic(c as any)),
        banca_ids: Array.isArray(config.banca_ids) ? config.banca_ids : [config.banca_id],
        base_url: primary.base_url,
        token_last4: primary.token_last4 ?? null,
        ad_account_id: primary.ad_account_id,
        pixel_id: primary.pixel_id,
        default_campaign_id: primary.default_campaign_id,
        is_active: primary.is_active,
        last_sync_at: primary.last_sync_at,
        last_sync_error: primary.last_sync_error,
        last_sync_date_preset: primary.last_sync_date_preset,
      });
    }

    if (!bancaId) {
      return errorResponse('Informe banca_id ou banca_ids', 400);
    }

    const integrationsList = await listMetaIntegrationsForBanca(bancaId);
    if (integrationsList.length === 0) {
      return successResponse({
        ...defaultConfigPayload,
        banca_ids: [],
        integrations: [],
      });
    }

    const primary = integrationsList[0];
    return successResponse({
      configured: true,
      integration_id: primary.id,
      integrations: integrationsList.map((c) => mapIntegrationPublic(c as any)),
      banca_ids: Array.isArray((primary as any).banca_ids) ? (primary as any).banca_ids : [bancaId],
      base_url: primary.base_url,
      token_last4: primary.token_last4 ?? null,
      ad_account_id: primary.ad_account_id,
      pixel_id: primary.pixel_id,
      default_campaign_id: primary.default_campaign_id,
      is_active: primary.is_active,
      last_sync_at: primary.last_sync_at,
      last_sync_error: primary.last_sync_error,
      last_sync_date_preset: primary.last_sync_date_preset,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaIdsRaw = body?.banca_ids;
    const bancaIdSingle = body?.banca_id;
    const bancaIds = Array.isArray(bancaIdsRaw)
      ? bancaIdsRaw.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : (bancaIdSingle ? [String(bancaIdSingle).trim()] : []);

    if (bancaIds.length === 0) {
      return errorResponse('banca_id ou banca_ids é obrigatório', 400);
    }

    const input = {
      base_url: body.base_url,
      access_token: body.access_token,
      ad_account_id: body.ad_account_id,
      pixel_id: body.pixel_id,
      default_campaign_id: body.default_campaign_id,
      is_active: body.is_active,
    };

    const integrationIdBody =
      body.integration_id != null && String(body.integration_id).trim() !== ''
        ? String(body.integration_id).trim()
        : undefined;
    const createNew = body.create_new_integration === true;
    const reuseTokenFrom =
      body.reuse_token_from_integration_id != null &&
      String(body.reuse_token_from_integration_id).trim() !== ''
        ? String(body.reuse_token_from_integration_id).trim()
        : null;

    const bancaContext = bancaIdSingle ? String(bancaIdSingle).trim() : bancaIds[0];
    const config = await upsertMetaConfig(bancaContext, input, bancaIds, {
      integration_id: integrationIdBody ?? null,
      create_new: createNew,
      reuse_token_from_integration_id: reuseTokenFrom,
    });

    return successResponse({
      configured: true,
      integration_id: config.id,
      banca_ids: (config as any).banca_ids ?? bancaIds,
      base_url: config.base_url,
      token_last4: config.token_last4 ?? null,
      ad_account_id: config.ad_account_id,
      pixel_id: config.pixel_id,
      default_campaign_id: config.default_campaign_id,
      is_active: config.is_active,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
