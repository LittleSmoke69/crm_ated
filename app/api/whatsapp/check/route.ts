import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { checkWhatsAppByWasender } from '@/lib/services/whatsapp-check-service';

/**
 * POST /api/whatsapp/check - Verifica se número está no WhatsApp (Wasender API)
 * Body: { phone: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

    if (!phone) {
      return errorResponse('phone é obrigatório', 400);
    }

    const result = await checkWhatsAppByWasender(phone);
    return successResponse(result);
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
