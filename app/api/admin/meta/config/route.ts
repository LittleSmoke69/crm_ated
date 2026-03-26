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
  upsertMetaConfig,
} from '@/lib/services/meta-sync-service';

const defaultConfigPayload = {
  configured: false,
  integration_id: null as string | null,
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
      return successResponse({
        configured: true,
        integration_id: config.id,
        banca_ids: Array.isArray(config.banca_ids) ? config.banca_ids : [config.banca_id],
        base_url: config.base_url,
        token_last4: config.token_last4 ?? null,
        ad_account_id: config.ad_account_id,
        pixel_id: config.pixel_id,
        default_campaign_id: config.default_campaign_id,
        is_active: config.is_active,
        last_sync_at: config.last_sync_at,
        last_sync_error: config.last_sync_error,
        last_sync_date_preset: config.last_sync_date_preset,
      });
    }

    if (!bancaId) {
      return errorResponse('Informe banca_id ou banca_ids', 400);
    }

    const config = await getMetaConfig(bancaId);
    if (!config) {
      return successResponse({
        ...defaultConfigPayload,
        banca_ids: [],
      });
    }

    return successResponse({
      configured: true,
      integration_id: config.id,
      banca_ids: Array.isArray((config as any).banca_ids) ? (config as any).banca_ids : [bancaId],
      base_url: config.base_url,
      // Retorna apenas os 4 últimos dígitos (sem máscara) para o client mascarar uma vez.
      token_last4: config.token_last4 ?? null,
      ad_account_id: config.ad_account_id,
      pixel_id: config.pixel_id,
      default_campaign_id: config.default_campaign_id,
      is_active: config.is_active,
      last_sync_at: config.last_sync_at,
      last_sync_error: config.last_sync_error,
      last_sync_date_preset: config.last_sync_date_preset,
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

    // Modelo compartilhado: atualiza/cria UMA integração e (opcionalmente) substitui vínculos para bancaIds
    const bancaContext = bancaIdSingle ? String(bancaIdSingle).trim() : bancaIds[0];
    const config = await upsertMetaConfig(bancaContext, input, bancaIds);

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
