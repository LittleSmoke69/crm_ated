/**
 * GET /api/admin/chat-customer-trail
 * Funil + trilha do cliente no chat de atendimento:
 *   1) Novo (sem gerente/captador) — primeira etapa
 *   2) Com gerente — passou da 1ª etapa (admin → gerente)
 *   3) Com captador — passou para o time de captura
 *   4) Resolvido
 *
 * O admin da 1ª etapa é recuperado de forma robusta:
 *   - chat_attendance_events.meta.assigned_by (transferência inicial)
 *   - primeira mensagem outbound de um admin
 *   - fallback: assigned_by atual se ainda for admin
 * (ao atribuir ao captador, assigned_by vira o gerente e apaga o admin da coluna).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type TrailStage = 'novo' | 'gerente' | 'captador' | 'resolvido';

const ADMIN_STATUSES = new Set(['admin', 'super_admin']);

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

function isAdminStatus(status: string | null | undefined): boolean {
  return ADMIN_STATUSES.has(String(status || '').toLowerCase());
}

async function resolveAdminIdsByConversation(conversationIds: string[]): Promise<Map<string, string>> {
  const adminByConv = new Map<string, string>();
  if (conversationIds.length === 0) return adminByConv;

  // 1) Eventos de transferência/atribuição — meta.assigned_by da 1ª delegação
  for (let i = 0; i < conversationIds.length; i += 80) {
    const chunk = conversationIds.slice(i, i + 80);
    const { data: events } = await supabaseServiceRole
      .from('chat_attendance_events')
      .select('conversation_id, event_type, meta, created_at')
      .in('conversation_id', chunk)
      .in('event_type', ['transferred', 'assigned'])
      .order('created_at', { ascending: true });

    const pendingIds = new Set<string>();
    for (const ev of events || []) {
      const convId = ev.conversation_id as string;
      if (adminByConv.has(convId)) continue;
      const meta = (ev.meta || {}) as { assigned_by?: string };
      const assignedBy = typeof meta.assigned_by === 'string' ? meta.assigned_by : null;
      if (assignedBy) pendingIds.add(assignedBy);
    }

    const statusById = new Map<string, string>();
    if (pendingIds.size > 0) {
      const { data: people } = await supabaseServiceRole
        .from('profiles')
        .select('id, status')
        .in('id', [...pendingIds]);
      for (const p of people || []) statusById.set(p.id, String(p.status || ''));
    }

    for (const ev of events || []) {
      const convId = ev.conversation_id as string;
      if (adminByConv.has(convId)) continue;
      const meta = (ev.meta || {}) as { assigned_by?: string };
      const assignedBy = typeof meta.assigned_by === 'string' ? meta.assigned_by : null;
      if (assignedBy && isAdminStatus(statusById.get(assignedBy))) {
        adminByConv.set(convId, assignedBy);
      }
    }
  }

  // 2) Fallback: primeira mensagem outbound de um admin na conversa
  const missing = conversationIds.filter((id) => !adminByConv.has(id));
  if (missing.length === 0) return adminByConv;

  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const { data: msgs } = await supabaseServiceRole
      .from('chat_messages')
      .select('conversation_id, user_id, timestamp, created_at')
      .in('conversation_id', chunk)
      .eq('from_me', true)
      .not('user_id', 'is', null)
      .order('timestamp', { ascending: true })
      .limit(2000);

    const senderIds = [...new Set((msgs || []).map((m) => m.user_id).filter(Boolean))] as string[];
    const statusById = new Map<string, string>();
    if (senderIds.length > 0) {
      const { data: people } = await supabaseServiceRole
        .from('profiles')
        .select('id, status')
        .in('id', senderIds);
      for (const p of people || []) statusById.set(p.id, String(p.status || ''));
    }

    for (const m of msgs || []) {
      const convId = m.conversation_id as string;
      if (adminByConv.has(convId)) continue;
      const uid = m.user_id as string | null;
      if (uid && isAdminStatus(statusById.get(uid))) {
        adminByConv.set(convId, uid);
      }
    }
  }

  return adminByConv;
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
    const convIds = rows.map((c) => c.id as string);
    const adminByConv = await resolveAdminIdsByConversation(convIds);

    const personIds = new Set<string>();
    for (const c of rows) {
      if (c.user_id) personIds.add(c.user_id);
      if (c.gerente_id) personIds.add(c.gerente_id);
      if (c.assigned_by) personIds.add(c.assigned_by);
      const adminId = adminByConv.get(c.id);
      if (adminId) personIds.add(adminId);
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

      // Admin da 1ª etapa (não o assigned_by atual, que vira gerente após 2ª atribuição)
      let adminId = adminByConv.get(c.id) || null;
      if (!adminId && c.assigned_by && isAdminStatus(assignedBy?.status)) {
        adminId = c.assigned_by;
      }
      const adminName = adminId ? nameById.get(adminId)?.name || null : null;

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
