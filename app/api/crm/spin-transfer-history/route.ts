import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

/**
 * GET /api/crm/spin-transfer-history
 * Proxy para histórico de giros (roleta) enviados a um lead.
 * Query: consultant_id (numérico), lead_id (id original do lead, pode ser string ex.: uuid-1530), banca_url (obrigatório), per_page, page.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;

    const consultantId = searchParams.get('consultant_id');
    const leadId = searchParams.get('lead_id');
    let bancaUrl = searchParams.get('banca_url')?.trim();
    const perPage = searchParams.get('per_page') || '15';
    const page = searchParams.get('page') || '1';

    if (!consultantId || !leadId) {
      return errorResponse('consultant_id e lead_id são obrigatórios.', 400);
    }
    if (!bancaUrl || bancaUrl === 'all') {
      return errorResponse('banca_url é obrigatório (use a URL da banca do lead).', 400);
    }

    // Consultor cujo CRM está sendo usado deve ser o dono do consultant_id; verificação opcional por userId
    const targetUserId = searchParams.get('userId') || requesterId;
    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado.', 403);
      }
    }

    let cleanBancaUrl = bancaUrl.replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
    cleanBancaUrl = cleanBancaUrl ? `https://${cleanBancaUrl}` : '';

    if (!cleanBancaUrl) {
      return errorResponse('banca_url inválido.', 400);
    }

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    const externalUrl = `${cleanBancaUrl}/api/crm/spin-transfer-history?consultant_id=${encodeURIComponent(consultantId)}&lead_id=${encodeURIComponent(leadId)}&per_page=${perPage}&page=${page}`;

    const response = await fetch(externalUrl, {
      method: 'GET',
      headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return successResponse({ data: [], pagination: { current_page: 1, per_page: Number(perPage), total: 0, last_page: 1 } });
      }
      const text = await response.text();
      console.error('[CRM spin-transfer-history] HTTP', response.status, text);
      return errorResponse(`Erro ao buscar histórico de giros: ${response.status}`);
    }

    const result = await response.json();
    return successResponse(result.data !== undefined ? result : { data: result?.data ?? [], pagination: result?.pagination });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM spin-transfer-history]', msg);
    return errorResponse(msg || 'Erro ao buscar histórico de giros.');
  }
}
