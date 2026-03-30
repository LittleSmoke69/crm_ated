import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * POST /api/crm/activations/schedules/add-groups
 * Adiciona grupos a um disparo existente (clona a configuração do agendamento fonte para os novos grupos).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { sourceScheduleId, groupIds } = body;

    if (!sourceScheduleId || !groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return errorResponse('sourceScheduleId e groupIds (array) são obrigatórios', 400);
    }

    const { data: source, error: fetchError } = await supabaseServiceRole
      .from('message_schedules')
      .select('*')
      .eq('id', sourceScheduleId)
      .single();

    if (fetchError || !source) {
      return errorResponse('Agendamento fonte não encontrado', 404);
    }

    if (source.user_id !== userId) {
      return errorResponse('Você não tem permissão para usar este agendamento', 403);
    }

    // Grupos já presentes neste disparo (mesmo message_id + instance_name + config)
    const { data: existingRows } = await supabaseServiceRole
      .from('message_schedules')
      .select('group_id')
      .eq('user_id', userId)
      .eq('message_id', source.message_id)
      .eq('instance_name', source.instance_name)
      .eq('schedule_type', source.schedule_type);

    const existingGroupIds = new Set((existingRows || []).map((r: { group_id: string }) => r.group_id));
    const uniqueIncoming = [
      ...new Set((groupIds as string[]).map((g) => String(g ?? '').trim()).filter(Boolean)),
    ];
    const toAdd = uniqueIncoming.filter((g: string) => !existingGroupIds.has(g));
    if (toAdd.length === 0) {
      return successResponse(
        { added: 0, schedules: [] },
        'Todos os grupos já estão neste disparo.'
      );
    }

    // Nomes dos grupos
    const { data: groups } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject')
      .in('group_id', toAdd);
    const groupNameMap = new Map<string, string>();
    (groups || []).forEach((g: { group_id: string; group_subject: string }) => {
      groupNameMap.set(g.group_id, g.group_subject || g.group_id);
    });

    const now = new Date().toISOString();
    const schedules = toAdd.map((groupId: string) => ({
      user_id: userId,
      message_id: source.message_id,
      group_id: groupId,
      group_subject: groupNameMap.get(groupId) || groupId,
      instance_name: source.instance_name,
      schedule_type: source.schedule_type,
      scheduled_at_utc: source.scheduled_at_utc,
      cron_expr: source.cron_expr,
      timezone: source.timezone || 'America/Sao_Paulo',
      recurring_days: source.recurring_days,
      recurring_time: source.recurring_time,
      next_run_utc: source.next_run_utc,
      status: source.status,
      locked_at: null,
      locked_by: null,
      attempts: 0,
      last_error: null,
      sent_at: null,
      created_at: now,
      updated_at: now,
    }));

    const { data: inserted, error: insertError } = await supabaseServiceRole
      .from('message_schedules')
      .insert(schedules)
      .select();

    if (insertError) {
      console.error('[add-groups] Erro ao inserir:', insertError);
      return errorResponse(`Erro ao adicionar grupos: ${insertError.message}`, 500);
    }

    return successResponse(
      { added: inserted?.length ?? 0, schedules: inserted ?? [] },
      `${inserted?.length ?? 0} grupo(s) adicionado(s) ao disparo.`
    );
  } catch (err: any) {
    console.error('❌ [add-groups] Erro geral:', err);
    return serverErrorResponse(err);
  }
}
