import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/crm/columns/reorder
 * Body: { ordered_ids: string[] } — ordem completa das colunas ativas.
 * Persiste em crm_columns.sort_order (fica fixa para todos do tenant).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    const status = String(profile?.status ?? '').toLowerCase();
    const allowed = ['super_admin', 'admin', 'gerente', 'captador', 'consultor'].includes(status);
    if (!allowed) {
      return errorResponse('Sem permissão para reordenar colunas do CRM.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const orderedIds = Array.isArray(body.ordered_ids)
      ? body.ordered_ids.filter((id: unknown) => typeof id === 'string' && id.trim())
      : [];

    if (orderedIds.length === 0) {
      return errorResponse('ordered_ids é obrigatório.', 400);
    }

    const now = new Date().toISOString();
    // Atualiza sequencialmente para evitar colisão de unique se existir
    for (let i = 0; i < orderedIds.length; i += 1) {
      const { error } = await supabaseServiceRole
        .from('crm_columns')
        .update({ sort_order: i, updated_at: now })
        .eq('id', orderedIds[i]);
      if (error) {
        return errorResponse(`Erro ao salvar ordem: ${error.message}`, 500);
      }
    }

    return successResponse({ ok: true, count: orderedIds.length });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
