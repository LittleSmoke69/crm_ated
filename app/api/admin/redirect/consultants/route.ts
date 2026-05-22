import { NextRequest } from 'next/server';
import { fetchUsersForConsultantPicker } from '@/lib/admin/redirect-group-consultant';
import { requireVslAdmin } from '@/lib/middleware/vsl-admin';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * GET /api/admin/redirect/consultants
 * Lista todos os usuários para vincular ao grupo (busca no picker).
 */
export async function GET(req: NextRequest) {
  try {
    await requireVslAdmin(req);
    const list = await fetchUsersForConsultantPicker();
    return successResponse(list);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Acesso negado') || msg.includes('não autenticado') || msg.includes('Perfil não encontrado')) {
      return errorResponse(msg, msg.includes('não autenticado') ? 401 : 403);
    }
    return serverErrorResponse(e);
  }
}
