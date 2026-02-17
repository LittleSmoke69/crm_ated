import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * GET /api/admin/disparo
 * Dados de disparo para o painel admin: resumo, dados diários no período, progressão por dia da semana, próximos agendamentos.
 * Query: from=YYYY-MM-DD, to=YYYY-MM-DD, upcomingLimit=50
 * Acesso: requireAdmin (super_admin, admin, dono_banca).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const upcomingLimit = Math.min(Number(searchParams.get('upcomingLimit')) || 50, 200);

    const now = new Date();
    const toDate = toParam ? new Date(toParam + 'T23:59:59.999Z') : new Date(now);
    const fromDate = fromParam ? new Date(fromParam + 'T00:00:00.000Z') : (() => {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      d.setHours(0, 0, 0, 0);
      return d;
    })();

    if (fromDate > toDate) {
      return errorResponse('Data inicial não pode ser maior que a final', 400);
    }

    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));

    // Resumo (contagens atuais)
    const [
      dispatchedTodayRes,
      nextExecutionsRes,
      failuresRes,
      successTotalRes,
      sentInRangeRes,
      upcomingRes,
    ] = await Promise.all([
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', startOfTodayUtc.toISOString())
        .lt('sent_at', endOfTodayUtc.toISOString()),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .in('status', ['scheduled', 'processing'])
        .gt('next_run_utc', now.toISOString()),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabaseServiceRole
        .from('message_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent'),
      supabaseServiceRole
        .from('message_schedules')
        .select('sent_at')
        .eq('status', 'sent')
        .gte('sent_at', fromDate.toISOString())
        .lte('sent_at', toDate.toISOString()),
      supabaseServiceRole
        .from('message_schedules')
        .select(`
          id,
          next_run_utc,
          instance_name,
          group_id,
          group_subject,
          schedule_type,
          user_id,
          messages ( id, title )
        `)
        .in('status', ['scheduled', 'processing'])
        .gt('next_run_utc', now.toISOString())
        .order('next_run_utc', { ascending: true })
        .limit(upcomingLimit),
    ]);

    const summary = {
      dispatchedToday: dispatchedTodayRes?.count ?? 0,
      nextExecutions: nextExecutionsRes?.count ?? 0,
      failures: failuresRes?.count ?? 0,
      successTotal: successTotalRes?.count ?? 0,
    };

    // Diário: agrupa sent_in_range por dia (data UTC)
    const dailyMap = new Map<string, number>();
    const weekdayMap = new Map<number, number>(Array.from({ length: 7 }, (_, i) => [i, 0]));

    const sentInRange = sentInRangeRes?.data || [];
    sentInRange.forEach((row: { sent_at: string }) => {
      const d = new Date(row.sent_at);
      const dateKey = d.toISOString().slice(0, 10);
      dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + 1);
      const dayOfWeek = d.getUTCDay();
      weekdayMap.set(dayOfWeek, (weekdayMap.get(dayOfWeek) || 0) + 1);
    });

    const daily: { date: string; count: number }[] = [];
    const d = new Date(fromDate);
    while (d <= toDate) {
      const dateKey = d.toISOString().slice(0, 10);
      daily.push({ date: dateKey, count: dailyMap.get(dateKey) || 0 });
      d.setDate(d.getDate() + 1);
    }

    const byWeekday = WEEKDAY_NAMES.map((name, i) => ({
      dayName: name,
      dayNumber: i,
      count: weekdayMap.get(i) ?? 0,
    }));

    // Busca nomes dos criadores (user_id -> full_name/email)
    const userIds = [...new Set((upcomingRes?.data || []).map((s: any) => s.user_id).filter(Boolean))];
    let creatorMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profilesData } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      (profilesData || []).forEach((p: any) => {
        creatorMap[p.id] = p.full_name?.trim() || p.email || p.id;
      });
    }

    const upcomingRaw = upcomingRes?.data || [];
    const upcoming = upcomingRaw.map((s: any) => ({
      id: s.id,
      next_run_utc: s.next_run_utc,
      message_title: s.messages?.title ?? 'Sem título',
      group_subject: s.group_subject ?? s.group_id ?? '—',
      instance_name: s.instance_name ?? '—',
      schedule_type: s.schedule_type,
      created_by: creatorMap[s.user_id] || s.user_id || '—',
    }));

    return successResponse({
      summary,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      daily,
      byWeekday,
      upcoming,
    });
  } catch (err: unknown) {
    console.error('❌ [ADMIN DISPARO] Erro:', err);
    return serverErrorResponse(err);
  }
}
