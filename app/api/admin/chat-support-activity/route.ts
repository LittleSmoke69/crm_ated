/**
 * GET /api/admin/chat-support-activity
 * Relatório da equipe do chat: admin, gerente e captador (sem super_admin).
 * Acesso: admin (tenant) e super_admin (todos).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ONLINE_WINDOW_MS = 120_000;

/** Cargos exibidos na gestão — super_admin fica de fora de propósito. */
const TEAM_STATUSES = ['admin', 'gerente', 'captador'] as const;

type TeamStatus = (typeof TEAM_STATUSES)[number];

type ActivityRow = {
  user_id: string;
  atendimentos: number;
  mensagens: number;
  em_atendimento: number;
  fora_janela: number;
};

const ROLE_LABEL: Record<TeamStatus, string> = {
  admin: 'Admin',
  gerente: 'Gerente',
  captador: 'Captador',
};

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = (profile?.status || '').toLowerCase();
    const isSuper = status === 'super_admin';
    const isAdmin = status === 'admin';
    if (!isSuper && !isAdmin) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999Z`).getTime() : null;
    const fromSec = fromMs !== null ? Math.floor(fromMs / 1000) : null;
    const toSec = toMs !== null ? Math.floor(toMs / 1000) : null;

    let teamQuery = supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email, status, last_seen_at, last_login_at, total_online_time, enroller')
      .in('status', [...TEAM_STATUSES]);

    if (isAdmin && profile?.zaploto_id) {
      teamQuery = teamQuery.eq('zaploto_id', profile.zaploto_id);
    }

    const { data: teamUsers, error: teamErr } = await teamQuery;
    if (teamErr) {
      console.error('[chat-support-activity] team users', teamErr.message);
      return errorResponse(`Erro ao buscar equipe: ${teamErr.message}`, 500);
    }

    const users = (teamUsers || []).filter((u) =>
      TEAM_STATUSES.includes(String(u.status || '') as TeamStatus)
    );
    const userIds = users.map((u) => u.id);

    const counts = new Map<string, ActivityRow>();
    if (userIds.length > 0) {
      const { data: actRows, error: actErr } = await supabaseServiceRole.rpc('chat_support_activity', {
        p_user_ids: userIds,
        p_from_sec: fromSec,
        p_to_sec: toSec,
      });
      if (actErr) {
        console.error('[chat-support-activity] rpc', actErr.message);
        return errorResponse(`Erro ao agregar atendimentos: ${actErr.message}`, 500);
      }
      for (const row of (actRows || []) as ActivityRow[]) {
        if (row.user_id) counts.set(row.user_id, row);
      }
    }

    const now = Date.now();
    const byUser = users
      .map((u) => {
        const role = String(u.status || '') as TeamStatus;
        const c = counts.get(u.id);
        const lastSeen = u.last_seen_at as string | null;
        const online = lastSeen ? now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS : false;
        return {
          user_id: u.id,
          name: u.full_name || u.email || u.id,
          email: u.email || null,
          role,
          role_label: ROLE_LABEL[role] || role,
          online,
          last_seen_at: lastSeen,
          last_login_at: (u.last_login_at as string | null) ?? null,
          total_online_time: Number(u.total_online_time) || 0,
          atendimentos_periodo: Number(c?.atendimentos) || 0,
          fora_janela: Number(c?.fora_janela) || 0,
          em_atendimento: Number(c?.em_atendimento) || 0,
          mensagens_periodo: Number(c?.mensagens) || 0,
        };
      })
      .sort((a, b) => {
        const roleOrder = { admin: 0, gerente: 1, captador: 2 } as Record<string, number>;
        const ro = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
        if (ro !== 0) return ro;
        if (a.online !== b.online) return a.online ? -1 : 1;
        if (b.atendimentos_periodo !== a.atendimentos_periodo)
          return b.atendimentos_periodo - a.atendimentos_periodo;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    const byRole = {
      admin: byUser.filter((u) => u.role === 'admin').length,
      gerente: byUser.filter((u) => u.role === 'gerente').length,
      captador: byUser.filter((u) => u.role === 'captador').length,
    };

    return successResponse({
      byUser,
      byRole,
      summary: {
        totalSupport: byUser.length,
        onlineNow: byUser.filter((u) => u.online).length,
        atendimentosPeriodo: byUser.reduce((s, u) => s + u.atendimentos_periodo, 0),
        foraJanelaPeriodo: byUser.reduce((s, u) => s + u.fora_janela, 0),
        mensagensPeriodo: byUser.reduce((s, u) => s + u.mensagens_periodo, 0),
      },
      from: fromDate || null,
      to: toDate || null,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
