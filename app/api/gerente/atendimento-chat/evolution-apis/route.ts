/**
 * GET /api/gerente/atendimento-chat/evolution-apis
 * Lista Evolution APIs ativas (para criar instância de atendimento).
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['gerente', 'super_admin', 'admin']);

    const { data: rows, error } = await supabaseServiceRole
      .from('evolution_apis')
      .select('id, name, base_url, is_active, is_blocked_for_instances')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      return errorResponse(`Erro ao listar APIs: ${error.message}`, 500);
    }

    const list = (rows || []).filter((r) => r.is_blocked_for_instances !== true);
    return successResponse(list);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
