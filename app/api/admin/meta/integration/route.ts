/**
 * DELETE — remove integração Meta (meta_integration_configs + vínculos em cascata).
 * PATCH — atualiza apenas vínculos banca ↔ integração (meta_integration_bancas).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { deleteMetaIntegrationConfig, moveMetaIntegrationToBancas, setMetaIntegrationBancaLinks } from '@/lib/services/meta-sync-service';

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const integrationId = String(body?.integration_id ?? '').trim();
    if (!integrationId) {
      return errorResponse('integration_id é obrigatório.', 400);
    }
    await deleteMetaIntegrationConfig(integrationId);
    return successResponse({ removed: true, integration_id: integrationId });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    if (err?.message?.includes('não encontrad')) {
      return errorResponse(err.message, 404);
    }
    return serverErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const integrationId = String(body?.integration_id ?? '').trim();
    const raw = body?.banca_ids;
    const moveFromOtherIntegrations = body?.move_bancas_from_other_integrations === true;
    const bancaIds = Array.isArray(raw)
      ? raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
      : [];

    if (!integrationId) {
      return errorResponse('integration_id é obrigatório.', 400);
    }
    if (bancaIds.length === 0) {
      return errorResponse('banca_ids deve conter ao menos uma banca.', 400);
    }

    const next = moveFromOtherIntegrations
      ? await moveMetaIntegrationToBancas(integrationId, bancaIds)
      : await setMetaIntegrationBancaLinks(integrationId, bancaIds);
    return successResponse({ integration_id: integrationId, banca_ids: next });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    if (err?.message?.includes('Informe ao menos') || err?.message?.includes('é obrigatório')) {
      return errorResponse(err.message, 400);
    }
    return serverErrorResponse(err);
  }
}
