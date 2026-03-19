/**
 * POST /api/gerente/consultant-request
 * Cria solicitação de consultores (banca + quantidade).
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const body = await req.json().catch(() => ({}));
    const bancaId = typeof body.banca_id === 'string' ? body.banca_id.trim() : '';
    const quantity = Math.max(1, Math.min(500, parseInt(String(body.quantity_requested), 10) || 1));
    if (!bancaId) return errorResponse('Selecione a banca.', 400);

    const { data: reqRow, error } = await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .insert({
        gerente_id: userId,
        banca_id: bancaId,
        quantity_requested: quantity,
        quantity_sent: 0,
      })
      .select('id, quantity_requested, created_at')
      .single();

    if (error) return errorResponse(error.message || 'Erro ao criar solicitação', 500);
    return successResponse(reqRow, 'Solicitação registrada.');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
