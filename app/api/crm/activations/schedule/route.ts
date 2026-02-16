import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateNextRecurringRun } from '@/lib/utils/recurring-schedule';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/crm/activations/schedule - Cria um agendamento de mensagem
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const {
      messageId,
      groupIds,
      instanceName,
      scheduleType,
      scheduledAtUTC,
      cronExpr,
      timezone,
      recurringDays,
      recurringTime,
    } = body;

    if (!messageId || !groupIds || !Array.isArray(groupIds) || groupIds.length === 0 || !instanceName) {
      return errorResponse('messageId, groupIds e instanceName são obrigatórios', 400);
    }

    if (!scheduleType || (scheduleType !== 'once' && scheduleType !== 'recurring')) {
      return errorResponse('scheduleType deve ser "once" ou "recurring"', 400);
    }

    if (scheduleType === 'once' && !scheduledAtUTC) {
      return errorResponse('scheduledAtUTC é obrigatório para agendamento pontual', 400);
    }

    if (scheduleType === 'recurring' && (!cronExpr || !recurringDays || !recurringTime)) {
      return errorResponse('cronExpr, recurringDays e recurringTime são obrigatórios para agendamento recorrente', 400);
    }

    // Verifica se a mensagem existe
    const { data: message, error: messageError } = await supabaseServiceRole
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    // Verifica se a instância existe e está ativa
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_active, status')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância não encontrada ou inativa', 404);
    }

    // Busca os nomes dos grupos da tabela whatsapp_groups
    const { data: groups, error: groupsError } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject')
      .in('group_id', groupIds);

    // Cria um mapa de group_id -> group_subject
    const groupNameMap = new Map<string, string>();
    if (groups) {
      groups.forEach((g: any) => {
        groupNameMap.set(g.group_id, g.group_subject || g.group_id);
      });
    }

    // Para recorrente, calcula o primeiro next_run_utc no servidor (hoje quando for o dia e horário válidos)
    const nextRunUTC =
      scheduleType === 'once'
        ? scheduledAtUTC
        : scheduleType === 'recurring'
          ? calculateNextRecurringRun(
              cronExpr || '',
              timezone || 'America/Sao_Paulo',
              recurringDays,
              recurringTime || ''
            ) || scheduledAtUTC
          : scheduledAtUTC;

    // Cria um registro de agendamento para cada grupo
    const schedules = groupIds.map((groupId: string) => ({
      user_id: userId,
      message_id: messageId,
      group_id: groupId,
      group_subject: groupNameMap.get(groupId) || groupId, // Nome do grupo ou ID como fallback
      instance_name: instanceName,
      schedule_type: scheduleType,
      scheduled_at_utc: scheduleType === 'once' ? scheduledAtUTC : null,
      cron_expr: scheduleType === 'recurring' ? cronExpr : null,
      timezone: timezone || 'America/Sao_Paulo',
      recurring_days: scheduleType === 'recurring' ? recurringDays : null,
      recurring_time: scheduleType === 'recurring' ? recurringTime : null,
      next_run_utc: nextRunUTC,
      status: 'scheduled',
      locked_at: null,
      locked_by: null,
      attempts: 0,
      last_error: null,
      sent_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data: insertedSchedules, error: insertError } = await supabaseServiceRole
      .from('message_schedules')
      .insert(schedules)
      .select();

    if (insertError) {
      console.error('Erro ao criar agendamentos:', insertError);
      return errorResponse(`Erro ao criar agendamentos: ${insertError.message}`, 500);
    }

    console.log(`✅ [SCHEDULE] Criados ${insertedSchedules?.length || 0} agendamentos para mensagem ${messageId}`);

    return successResponse(
      {
        schedules: insertedSchedules,
        count: insertedSchedules?.length || 0,
      },
      `Agendamento criado com sucesso para ${insertedSchedules?.length || 0} grupo(s)`
    );
  } catch (err: any) {
    console.error(`❌ [SCHEDULE] Erro geral:`, err);
    return serverErrorResponse(err);
  }
}

