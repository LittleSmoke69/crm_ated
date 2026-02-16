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
  upsertMetaConfig,
} from '@/lib/services/meta-sync-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const config = await getMetaConfig(bancaId);
    if (!config) {
      return successResponse({
        configured: false,
        base_url: 'https://graph.facebook.com/v19.0',
        token_last4: null,
        ad_account_id: null,
        pixel_id: null,
        default_campaign_id: null,
        is_active: true,
        last_sync_at: null,
        last_sync_error: null,
        last_sync_date_preset: null,
      });
    }

    return successResponse({
      configured: true,
      base_url: config.base_url,
      token_last4: config.token_last4 ? `••••${config.token_last4}` : null,
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
    const bancaId = body?.banca_id;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const config = await upsertMetaConfig(bancaId, {
      base_url: body.base_url,
      access_token: body.access_token,
      ad_account_id: body.ad_account_id,
      pixel_id: body.pixel_id,
      default_campaign_id: body.default_campaign_id,
      is_active: body.is_active,
    });

    return successResponse({
      configured: true,
      base_url: config.base_url,
      token_last4: config.token_last4 ? `••••${config.token_last4}` : null,
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
