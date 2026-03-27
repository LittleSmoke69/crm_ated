import { NextRequest } from 'next/server';
import {
  canAssignConsultorWithoutBancaCheck,
  fetchConsultantsForBanca,
} from '@/lib/admin/redirect-group-consultant';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { requireVslAdmin } from '@/lib/middleware/vsl-admin';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/redirect/consultants?banca_id=uuid
 * Lista consultores da banca. Gestor só acessa bancas em que está em user_bancas.
 */
export async function GET(req: NextRequest) {
  try {
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() ?? '';
    if (!bancaId || !UUID_RE.test(bancaId)) {
      return errorResponse('banca_id válido (UUID) é obrigatório', 400);
    }

    const { userId, profile } = await requireVslAdmin(req);

    if (!canAssignConsultorWithoutBancaCheck(profile)) {
      const bancas = await getBancasDoUsuario(userId);
      if (!bancas.some((b) => b.id === bancaId)) {
        return errorResponse('Acesso negado: você não está vinculado a esta banca.', 403);
      }
    }

    const list = await fetchConsultantsForBanca(bancaId);
    return successResponse(list);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Acesso negado') || msg.includes('não autenticado') || msg.includes('Perfil não encontrado')) {
      return errorResponse(msg, msg.includes('não autenticado') ? 401 : 403);
    }
    return serverErrorResponse(e);
  }
}
