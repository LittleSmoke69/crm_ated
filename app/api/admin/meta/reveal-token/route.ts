/**
 * POST /api/admin/meta/reveal-token
 * Retorna o access token em texto plano (apenas admin), para exibição controlada na UI.
 * Body: { banca_id: string }
 * Não registrar o token em logs.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getDecryptedTokenByIntegrationId,
  getDecryptedTokenForReveal,
  isMetaIntegrationLinkedToBanca,
} from '@/lib/services/meta-sync-service';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const bancaId = String(body?.banca_id ?? '').trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }

    const integrationIdRaw =
      body?.integration_id != null && String(body.integration_id).trim() !== ''
        ? String(body.integration_id).trim()
        : null;

    let token: string | null = null;

    // integration_id só vale se estiver vinculado a esta banca (evita UUID errado na UI bloquear o fallback).
    if (integrationIdRaw) {
      const linked = await isMetaIntegrationLinkedToBanca(integrationIdRaw, bancaId);
      if (linked) {
        token = await getDecryptedTokenByIntegrationId(integrationIdRaw, { requireActive: false });
      }
    }

    if (!token) {
      token = await getDecryptedTokenForReveal(bancaId);
    }

    if (!token) {
      return errorResponse(
        'Não foi possível revelar o token: nenhum access_token_encrypted encontrado para esta banca, integração inexistente ou falha ao descriptografar (chave ENCRYPTION_KEY alinhada ao ambiente?).',
        404
      );
    }

    return successResponse({ access_token: token });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
