import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateNextRecurringRun } from '@/lib/utils/recurring-schedule';

export const runtime = 'nodejs';

/**
 * POST /api/crm/activations/schedules/recalculate-recurring
 * Recalcula next_run_utc para todos os agendamentos recorrentes (scheduled ou paused).
 * Corrige dados criados antes da correção de timezone.
 * Apenas admin ou super_admin.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    const canRun =
      profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canRun) {
      return errorResponse('Sem permissão. Apenas admin ou super_admin.', 403);
    }

    const { data: schedules, error: fetchError } = await supabaseServiceRole
      .from('message_schedules')
      .select('id, schedule_type, timezone, cron_expr, recurring_days, recurring_time')
      .eq('schedule_type', 'recurring')
      .in('status', ['scheduled', 'paused']);

    if (fetchError) {
      console.error('[recalculate-recurring] Erro ao buscar agendamentos:', fetchError);
      return errorResponse(`Erro ao buscar agendamentos: ${fetchError.message}`, 500);
    }

    if (!schedules?.length) {
      return successResponse(
        { updated: 0, total: 0 },
        'Nenhum agendamento recorrente ativo para recalcular.'
      );
    }

    let updated = 0;
    const tz = (s: (typeof schedules)[0]) => s.timezone || 'America/Sao_Paulo';
    const timeStr = (s: (typeof schedules)[0]) => {
      const t = s.recurring_time;
      if (typeof t === 'string') return t.includes(':') ? t : `${t.slice(0, 2)}:${t.slice(2)}`;
      return '';
    };

    for (const schedule of schedules) {
      const recurringTime = timeStr(schedule);
      const nextRunUTC = calculateNextRecurringRun(
        schedule.cron_expr || '',
        tz(schedule),
        schedule.recurring_days ?? [],
        recurringTime,
        () => {}
      );

      if (!nextRunUTC) continue;

      const { error: updateError } = await supabaseServiceRole
        .from('message_schedules')
        .update({
          next_run_utc: nextRunUTC,
          updated_at: new Date().toISOString(),
        })
        .eq('id', schedule.id);

      if (updateError) {
        console.error(`[recalculate-recurring] Erro ao atualizar schedule ${schedule.id}:`, updateError);
        continue;
      }
      updated++;
    }

    return successResponse(
      { updated, total: schedules.length },
      `Próxima execução recalculada para ${updated} de ${schedules.length} agendamento(s) recorrente(s).`
    );
  } catch (err: unknown) {
    console.error('❌ [recalculate-recurring] Erro geral:', err);
    return serverErrorResponse(err);
  }
}
