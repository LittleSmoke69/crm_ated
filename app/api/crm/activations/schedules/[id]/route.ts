import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * PATCH /api/crm/activations/schedules/[id] - Atualiza um agendamento
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { status, scheduled_at_utc, instance_name, group_id, group_subject } = body;
    const { id } = await params;

    // Valida que pelo menos um campo foi fornecido
    const hasUpdate = status !== undefined || scheduled_at_utc !== undefined || instance_name !== undefined
      || group_id !== undefined || group_subject !== undefined;
    if (!hasUpdate) {
      return errorResponse('Pelo menos um campo deve ser fornecido para atualização', 400);
    }

    // Verifica se o agendamento pertence ao usuário
    const { data: schedule, error: checkError } = await supabaseServiceRole
      .from('message_schedules')
      .select('id, user_id, schedule_type')
      .eq('id', id)
      .single();

    if (checkError || !schedule) {
      return errorResponse('Agendamento não encontrado', 404);
    }

    if (schedule.user_id !== userId) {
      return errorResponse('Você não tem permissão para atualizar este agendamento', 403);
    }

    // Monta objeto de atualização
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) {
      updateData.status = status;
    }

    if (scheduled_at_utc !== undefined && schedule.schedule_type === 'once') {
      updateData.scheduled_at_utc = scheduled_at_utc;
      // Atualiza next_run_utc também para agendamentos pontuais
      updateData.next_run_utc = scheduled_at_utc;
    }

    if (instance_name !== undefined) {
      updateData.instance_name = instance_name;
    }

    if (group_id !== undefined) {
      updateData.group_id = group_id;
    }
    if (group_subject !== undefined) {
      updateData.group_subject = group_subject;
    }

    // Atualiza o agendamento
    const { data: updated, error: updateError } = await supabaseServiceRole
      .from('message_schedules')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return errorResponse(`Erro ao atualizar agendamento: ${updateError.message}`, 500);
    }

    return successResponse(updated, 'Agendamento atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/crm/activations/schedules/[id] - Exclui um agendamento
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    // Verifica se o agendamento pertence ao usuário
    const { data: schedule, error: checkError } = await supabaseServiceRole
      .from('message_schedules')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (checkError || !schedule) {
      return errorResponse('Agendamento não encontrado', 404);
    }

    if (schedule.user_id !== userId) {
      return errorResponse('Você não tem permissão para excluir este agendamento', 403);
    }

    // Exclui o agendamento
    const { error: deleteError } = await supabaseServiceRole
      .from('message_schedules')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return errorResponse(`Erro ao excluir agendamento: ${deleteError.message}`, 500);
    }

    return successResponse(null, 'Agendamento excluído com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

