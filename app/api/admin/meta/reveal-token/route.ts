/**
 * POST /api/admin/meta/reveal-token
 * Retorna o access token em texto plano (apenas admin), para exibição controlada na UI.
 * Body: { banca_id: string }
 * Não registrar o token em logs.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDecryptedToken } from '@/lib/services/meta-sync-service';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const bancaId = String(body?.banca_id ?? '').trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }

    const token = await getDecryptedToken(bancaId);
    if (!token) {
      return errorResponse('Token não encontrado ou não foi possível descriptografar.', 404);
    }

    return successResponse({ access_token: token });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
