/**
 * GET /api/admin/chat-customer-trail
 * Funil + trilha do cliente no chat de atendimento:
 *   1) Novo (sem gerente/captador) — primeira etapa
 *   2) Com gerente — passou da 1ª etapa (admin → gerente)
 *   3) Com captador — passou para o time de captura
 *   4) Resolvido
 * Acesso: admin / super_admin (escopo tenant para admin).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type TrailStage = 'novo' | 'gerente' | 'captador' | 'resolvido';

function resolveStage(conv: {
  user_id?: string | null;
  gerente_id?: string | null;
  attendance_status?: string | null;
}): TrailStage {
  if (String(conv.attendance_status || '') === 'resolvido') return 'resolvido';
  if (conv.user_id) return 'captador';
  if (conv.gerente_id) return 'gerente';
  return 'novo';
}

function stageLabel(stage: TrailStage): string {
  switch (stage) {
    case 'novo':
      return '1ª etapa — Novo (admin)';
    case 'gerente':
      return '2ª etapa — Com gerente';
    case 'captador':
      return '3ª etapa — Com captador';
    case 'resolvido':
      return 'Resolvido';
  }
}

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
    const fromIso = fromDate ? `${fromDate}T00:00:00.000Z` : null;
    const toIso = toDate ? `${toDate}T23:59:59.999Z` : null;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '40', 10) || 40, 1), 100);

    let query = supabaseServiceRole
      .from('chat_conversations')
      .select(
        'id, title, remote_jid, user_id, gerente_id, assigned_by, assigned_at, assignment_status, attendance_status, last_message_at, last_message_preview, created_at, workspace_id, instance_id, whatsapp_config_id'
      )
      .eq('is_group', false)
      .order('last_message_at', { ascending: false })
      .limit(800);

    if (isAdmin && profile?.zaploto_id) {
      query = query.eq('workspace_id', profile.zaploto_id);
    }
    if (fromIso) query = query.gte('last_message_at', fromIso);
    if (toIso) query = query.lte('last_message_at', toIso);

    const { data: conversations, error } = await query;
    if (error) {
      console.error('[chat-customer-trail]', error.message);
      return errorResponse(`Erro ao carregar trilha: ${error.message}`, 500);
    }

    const rows = conversations || [];
    const personIds = new Set<string>();
    for (const c of rows) {
      if (c.user_id) personIds.add(c.user_id);
      if (c.gerente_id) personIds.add(c.gerente_id);
      if (c.assigned_by) personIds.add(c.assigned_by);
    }

    const nameById = new Map<string, { name: string; status: string }>();
    if (personIds.size > 0) {
      const { data: people } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, username, email, status')
        .in('id', [...personIds]);
      for (const p of people || []) {
        nameById.set(p.id, {
          name: p.full_name || p.username || p.email || p.id,
          status: String(p.status || ''),
        });
      }
    }

    const funnel = {
      novo: 0,
      gerente: 0,
      captador: 0,
      resolvido: 0,
      total: rows.length,
    };

    const trail = rows.map((c) => {
      const stage = resolveStage(c);
      funnel[stage] += 1;
      const assignedBy = c.assigned_by ? nameById.get(c.assigned_by) : null;
      const gerente = c.gerente_id ? nameById.get(c.gerente_id) : null;
      const captador = c.user_id ? nameById.get(c.user_id) : null;
      // Quem iniciou/delegou: assigned_by se admin; senão mantém o papel
      const adminName =
        assignedBy && (assignedBy.status === 'admin' || assignedBy.status === 'super_admin')
          ? assignedBy.name
          : null;

      return {
        conversation_id: c.id,
        title: c.title || c.remote_jid,
        phone: String(c.remote_jid || '').replace(/@s\.whatsapp\.net$/i, ''),
        stage,
        stage_label: stageLabel(stage),
        passed_first_stage: stage === 'gerente' || stage === 'captador' || stage === 'resolvido',
        admin_name: adminName,
        gerente_name: gerente?.name || null,
        captador_name: captador?.name || null,
        assigned_by_name: assignedBy?.name || null,
        assigned_by_status: assignedBy?.status || null,
        assigned_at: c.assigned_at,
        last_message_at: c.last_message_at,
        last_message_preview: c.last_message_preview,
        attendance_status: c.attendance_status,
        steps: [
          {
            key: 'novo',
            label: '1ª etapa',
            done: true,
            active: stage === 'novo',
            actor: adminName,
          },
          {
            key: 'gerente',
            label: 'Gerente',
            done: stage === 'gerente' || stage === 'captador' || stage === 'resolvido',
            active: stage === 'gerente',
            actor: gerente?.name || null,
          },
          {
            key: 'captador',
            label: 'Captador',
            done: stage === 'captador' || stage === 'resolvido',
            active: stage === 'captador',
            actor: captador?.name || null,
          },
          {
            key: 'resolvido',
            label: 'Resolvido',
            done: stage === 'resolvido',
            active: stage === 'resolvido',
            actor: null,
          },
        ],
      };
    });

    // Lista recente prioriza quem já saiu da 1ª etapa, depois por data
    const recent = [...trail]
      .sort((a, b) => {
        const rank = (s: TrailStage) =>
          s === 'captador' ? 0 : s === 'gerente' ? 1 : s === 'resolvido' ? 2 : 3;
        const rd = rank(a.stage) - rank(b.stage);
        if (rd !== 0) return rd;
        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
      })
      .slice(0, limit);

    return successResponse({
      period: { from: fromDate, to: toDate },
      funnel,
      funnel_labels: {
        novo: '1ª etapa — Novo (fila admin)',
        gerente: '2ª etapa — Com gerente',
        captador: '3ª etapa — Com captador',
        resolvido: 'Resolvido',
      },
      recent,
      totals: {
        passed_first_stage: funnel.gerente + funnel.captador + funnel.resolvido,
        with_captador: funnel.captador,
      },
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
