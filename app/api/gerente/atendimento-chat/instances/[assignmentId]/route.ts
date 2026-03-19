/**
 * PATCH /api/gerente/atendimento-chat/instances/[assignmentId]
 * Body: { consultor_user_id: string | null }
 */

import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const { userId } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);
    const { assignmentId } = await context.params;

    if (!assignmentId) {
      return errorResponse('assignmentId é obrigatório', 400);
    }

    const body = await req.json().catch(() => ({})) as { consultor_user_id?: string | null };
    if (!('consultor_user_id' in body)) {
      return errorResponse('consultor_user_id é obrigatório (use null para remover)', 400);
    }

    const consultorUserId =
      body.consultor_user_id === null || body.consultor_user_id === ''
        ? null
        : String(body.consultor_user_id);

    const { data: row, error: fetchErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('id, gerente_user_id')
      .eq('id', assignmentId)
      .single();

    if (fetchErr || !row) {
      return errorResponse('Vínculo não encontrado', 404);
    }

    if (row.gerente_user_id !== userId) {
      const { data: prof } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', userId)
        .single();
      const st = (prof?.status || '').toLowerCase();
      if (st !== 'super_admin' && st !== 'admin') {
        return errorResponse('Acesso negado.', 403);
      }
    }

    if (consultorUserId) {
      const allowed = await canAccessUser(row.gerente_user_id, consultorUserId);
      if (!allowed) {
        return errorResponse('Consultor não pertence à hierarquia do gerente deste vínculo.', 403);
      }
      const { data: consultorProfile } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', consultorUserId)
        .single();
      if ((consultorProfile?.status || '').toLowerCase() !== 'consultor') {
        return errorResponse('O usuário informado não é um consultor.', 400);
      }
    }

    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .update({
        consultor_user_id: consultorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (upErr) {
      return errorResponse(`Erro ao atualizar: ${upErr.message}`, 500);
    }

    return successResponse(updated);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
