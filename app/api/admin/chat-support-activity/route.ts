/**
 * GET /api/admin/chat-support-activity
 * Relatório operacional da equipe de suporte: quais usuários do cargo "suporte" estão
 * acessando (online / último acesso) e quantos atendimentos cada um fez no período.
 * Acesso: admin (escopo do tenant) e super_admin (todos).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Considerado "online" se o heartbeat ocorreu nos últimos 2 minutos (mesmo critério do painel admin). */
const ONLINE_WINDOW_MS = 120_000;

/** Linha agregada da RPC chat_support_activity. */
type ActivityRow = {
  user_id: string;
  atendimentos: number;
  mensagens: number;
  em_atendimento: number;
  fora_janela: number;
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
      return errorResponse('Acesso negado. Apenas admin e super_admin.', 403);
    }

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('from'); // YYYY-MM-DD
    const toDate = searchParams.get('to'); // YYYY-MM-DD
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999Z`).getTime() : null;
    // chat_messages.timestamp é unix em segundos
    const fromSec = fromMs !== null ? Math.floor(fromMs / 1000) : null;
    const toSec = toMs !== null ? Math.floor(toMs / 1000) : null;

    // 1) Equipe de atendimento: admins (o cargo "suporte" foi aposentado e remapeado para admin)
    let supportQuery = supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email, status, last_seen_at, last_login_at, total_online_time')
      .in('status', ['admin', 'suporte']);

    if (isAdmin && profile?.zaploto_id) {
      supportQuery = supportQuery.eq('zaploto_id', profile.zaploto_id);
    }

    const { data: supportUsers, error: supErr } = await supportQuery;
    if (supErr) {
      console.error('[chat-support-activity] support users', supErr.message);
      return errorResponse(`Erro ao buscar equipe de suporte: ${supErr.message}`, 500);
    }

    const users = supportUsers || [];
    const userIds = users.map((u) => u.id);

    // 2) Atendimentos agregados no banco (RPC) — evita o limite de 1000 linhas do PostgREST.
    //    Conta pelo histórico de mensagens (from_me=true, chat_messages.user_id = usuário do suporte):
    //    atendimentos = conversas distintas no período; mensagens = mensagens enviadas no período;
    //    em_atendimento = aberta e ativa (dentro da janela de 24h p/ WhatsApp Oficial);
    //    fora_janela = WhatsApp Oficial cuja última mensagem do cliente passou de 24h.
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
        const c = counts.get(u.id);
        const lastSeen = u.last_seen_at as string | null;
        const online = lastSeen ? now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS : false;
        return {
          user_id: u.id,
          name: u.full_name || u.email || u.id,
          email: u.email || null,
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
        // Online primeiro, depois por atendimentos no período, depois nome
        if (a.online !== b.online) return a.online ? -1 : 1;
        if (b.atendimentos_periodo !== a.atendimentos_periodo)
          return b.atendimentos_periodo - a.atendimentos_periodo;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    return successResponse({
      byUser,
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
