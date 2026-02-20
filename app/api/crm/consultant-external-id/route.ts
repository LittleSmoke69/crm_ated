import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

function normalizeBancaUrl(raw: string): string {
  let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return u ? (u.startsWith('http') ? u : `https://${u}`) : '';
}

/**
 * GET /api/crm/consultant-external-id?userId=xxx&banca_url=yyy
 * Retorna o id do consultor na API externa (consultant_id) para uso em spin-transfer e send-spins.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;

    const targetUserId = searchParams.get('userId') || requesterId;
    const bancaUrl = searchParams.get('banca_url')?.trim();

    if (!bancaUrl || bancaUrl === 'all') {
      return errorResponse('banca_url é obrigatório.', 400);
    }

    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado.', 403);
      }
    }

    const profile = await getUserProfile(targetUserId);
    if (!profile?.email) {
      return errorResponse('Perfil ou e-mail do consultor não encontrado.');
    }

    const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
    if (!cleanBancaUrl) {
      return errorResponse('banca_url inválido.', 400);
    }

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    const url = `${cleanBancaUrl}/api/crm/user-consultant-info?email=${encodeURIComponent(profile.email)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return errorResponse('Não foi possível obter o id do consultor na banca.');
    }

    const body = await response.json();
    const consultantId = body?.consultant_id ?? body?.usuario?.id ?? body?.id ?? null;
    if (consultantId == null) {
      return errorResponse('Resposta da banca não contém consultant_id.');
    }

    return successResponse({ consultant_id: Number(consultantId) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM consultant-external-id]', msg);
    return errorResponse(msg || 'Erro ao obter id do consultor.');
  }
}
