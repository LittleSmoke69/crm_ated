/**
 * GET /api/atendimento-chat/consultores
 * Lista consultores que o usuário pode vincular às instâncias (hierarquia).
 */

import { NextRequest } from 'next/server';
import { requireStatus, getSubordinates } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'dono_banca']);

    const st = (profile.status || '').toLowerCase();
    let consultores: { id: string; full_name: string | null; email: string | null }[] = [];

    if (st === 'gerente') {
      const list = await getConsultorsByManager(userId);
      consultores = list.map((c) => ({
        id: c.id,
        full_name: c.full_name,
        email: c.email,
      }));
    } else if (st === 'dono_banca') {
      const subs = await getSubordinates(userId);
      consultores = subs
        .filter((p) => (p.status || '').toLowerCase() === 'consultor')
        .map((c) => ({
          id: c.id,
          full_name: c.full_name,
          email: c.email,
        }));
    }

    return successResponse(consultores);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
