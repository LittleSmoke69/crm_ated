import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

/**
 * POST /api/crm/send-spins-to-lead
 * Envia giros da roleta para um lead.
 * Body: { consultant_id: number, lead_id: number | string (id original do lead), quantity: number, banca_url: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);

    let body: { consultant_id?: number; lead_id?: number | string; quantity?: number; banca_url?: string; userId?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse('Corpo da requisição inválido (JSON esperado).', 400);
    }

    const consultantId = body.consultant_id;
    const leadId = body.lead_id;
    const quantity = body.quantity;
    let bancaUrl = body.banca_url?.trim();

    if (consultantId == null || leadId == null || quantity == null) {
      return errorResponse('consultant_id, lead_id e quantity são obrigatórios.', 400);
    }
    if (typeof quantity !== 'number' || quantity < 1) {
      return errorResponse('quantity deve ser um número positivo.', 400);
    }
    if (!bancaUrl || bancaUrl === 'all') {
      return errorResponse('banca_url é obrigatório.', 400);
    }

    const targetUserId = body.userId || requesterId;
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

    const externalUrl = `${cleanBancaUrl}/api/crm/send-spins-to-lead`;

    const response = await fetch(externalUrl, {
      method: 'POST',
      headers: {
        'X-API-KEY': cleanApiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        consultant_id: Number(consultantId),
        lead_id: typeof leadId === 'string' ? leadId : Number(leadId),
        quantity: Number(quantity),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[CRM send-spins-to-lead] HTTP', response.status, text);
      return errorResponse(`Erro ao enviar giros: ${response.status}`);
    }

    const result = await response.json();
    return successResponse(result.data !== undefined ? result : result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM send-spins-to-lead]', msg);
    return errorResponse(msg || 'Erro ao enviar giros.');
  }
}
