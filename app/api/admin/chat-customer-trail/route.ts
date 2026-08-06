/**
 * GET /api/admin/chat-customer-trail
 * Funil + trilha do cliente. Admin da 1ª etapa vem de:
 *   1) chat_conversations.first_admin_id (persistido)
 *   2) eventos transferred/assigned (meta.assigned_by)
 *   3) mensagem outbound de admin/super_admin
 *   4) assigned_by atual se ainda for admin
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

function parseMetaAssignedBy(meta: unknown): string | null {
  if (!meta) return null;
  const obj = typeof meta === 'string' ? (() => { try { return JSON.parse(meta); } catch { return null; } })() : meta;
  if (!obj || typeof obj !== 'object') return null;
  const assignedBy = (obj as { assigned_by?: unknown }).assigned_by;
  return typeof assignedBy === 'string' && assignedBy.length > 0 ? assignedBy : null;
}

/** IDs de todos admin/super_admin do tenant (ou global). */
async function listAdminProfileIds(zaplotoId: string | null): Promise<string[]> {
  let q = supabaseServiceRole
    .from('profiles')
    .select('id')
    .in('status', ['admin', 'super_admin']);
  if (zaplotoId) q = q.or(`zaploto_id.eq.${zaplotoId},status.eq.super_admin`);
  const { data } = await q;
  return (data || []).map((p) => p.id as string);
}

async function resolveAdminIdsByConversation(
  conversationIds: string[],
  prefilled: Map<string, string>,
  zaplotoId: string | null
): Promise<Map<string, string>> {
  const adminByConv = new Map<string, string>(prefilled);
  if (conversationIds.length === 0) return adminByConv;

  const missingAfterPrefill = () => conversationIds.filter((id) => !adminByConv.has(id));

  // 1) Eventos
  for (let i = 0; i < conversationIds.length; i += 100) {
    const chunk = conversationIds.slice(i, i + 100);
    const still = chunk.filter((id) => !adminByConv.has(id));
    if (still.length === 0) continue;

    const { data: events } = await supabaseServiceRole
      .from('chat_attendance_events')
      .select('conversation_id, event_type, meta, created_at')
      .in('conversation_id', still)
      .in('event_type', ['transferred', 'assigned'])
      .order('created_at', { ascending: true });

    const pendingIds = new Set<string>();
    for (const ev of events || []) {
      const assignedBy = parseMetaAssignedBy(ev.meta);
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
      const assignedBy = parseMetaAssignedBy(ev.meta);
      if (assignedBy && isAdminStatus(statusById.get(assignedBy))) {
        adminByConv.set(convId, assignedBy);
      }
    }
  }

  // 2) Mensagens outbound de admin/super_admin (filtra por user_id — sem limit global enganoso)
  const stillMissing = missingAfterPrefill();
  if (stillMissing.length === 0) return adminByConv;

  const adminIds = await listAdminProfileIds(zaplotoId);
  if (adminIds.length > 0) {
    for (let i = 0; i < stillMissing.length; i += 50) {
      const chunk = stillMissing.slice(i, i + 50).filter((id) => !adminByConv.has(id));
      if (chunk.length === 0) continue;
      const { data: msgs } = await supabaseServiceRole
        .from('chat_messages')
        .select('conversation_id, user_id')
        .in('conversation_id', chunk)
        .in('user_id', adminIds)
        .eq('from_me', true);

      for (const m of msgs || []) {
        const convId = m.conversation_id as string;
        if (adminByConv.has(convId)) continue;
        if (m.user_id) adminByConv.set(convId, m.user_id as string);
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

    const selectWithAdmin =
      'id, title, remote_jid, user_id, gerente_id, assigned_by, first_admin_id, assigned_at, assignment_status, attendance_status, last_message_at, last_message_preview, created_at, workspace_id, instance_id, whatsapp_config_id';
    const selectWithoutAdmin =
      'id, title, remote_jid, user_id, gerente_id, assigned_by, assigned_at, assignment_status, attendance_status, last_message_at, last_message_preview, created_at, workspace_id, instance_id, whatsapp_config_id';

    const buildQuery = (selectCols: string) => {
      let q = supabaseServiceRole
        .from('chat_conversations')
        .select(selectCols)
        .eq('is_group', false)
        .order('last_message_at', { ascending: false })
        .limit(800);
      if (isAdmin && profile?.zaploto_id) {
        q = q.eq('workspace_id', profile.zaploto_id);
      }
      if (fromIso) q = q.gte('last_message_at', fromIso);
      if (toIso) q = q.lte('last_message_at', toIso);
      return q;
    };

    let hasFirstAdminCol = true;
    let { data: conversations, error } = await buildQuery(selectWithAdmin);
    if (error && /first_admin_id/i.test(error.message)) {
      hasFirstAdminCol = false;
      ({ data: conversations, error } = await buildQuery(selectWithoutAdmin));
    }
    if (error) {
      console.error('[chat-customer-trail]', error.message);
      return errorResponse(`Erro ao carregar trilha: ${error.message}`, 500);
    }

    const rows = (conversations || []) as Array<Record<string, unknown> & {
      id: string;
      user_id?: string | null;
      gerente_id?: string | null;
      assigned_by?: string | null;
      first_admin_id?: string | null;
      attendance_status?: string | null;
      title?: string | null;
      remote_jid?: string | null;
      assigned_at?: string | null;
      last_message_at?: string | null;
      last_message_preview?: string | null;
    }>;
    const convIds = rows.map((c) => c.id as string);

    const prefilled = new Map<string, string>();
    for (const c of rows) {
      if (c.first_admin_id) prefilled.set(c.id, c.first_admin_id as string);
    }

    const adminByConv = await resolveAdminIdsByConversation(
      convIds,
      prefilled,
      isAdmin ? profile?.zaploto_id || null : null
    );

    // Persiste o que descobrimos (best-effort) para as próximas cargas
    if (hasFirstAdminCol) {
      const toPersist = [...adminByConv.entries()].filter(([id]) => {
        const row = rows.find((r) => r.id === id);
        return row && !row.first_admin_id;
      });
      if (toPersist.length > 0) {
        await Promise.all(
          toPersist.slice(0, 100).map(([id, adminId]) =>
            supabaseServiceRole
              .from('chat_conversations')
              .update({ first_admin_id: adminId, updated_at: new Date().toISOString() })
              .eq('id', id)
              .is('first_admin_id', null)
          )
        );
      }
    }

    const personIds = new Set<string>();
    for (const c of rows) {
      if (c.user_id) personIds.add(c.user_id);
      if (c.gerente_id) personIds.add(c.gerente_id);
      if (c.assigned_by) personIds.add(c.assigned_by);
      const adminId = adminByConv.get(c.id) || (c.first_admin_id as string | null);
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

      let adminId = adminByConv.get(c.id) || (c.first_admin_id as string | null) || null;
      if (!adminId && c.assigned_by && isAdminStatus(assignedBy?.status)) {
        adminId = c.assigned_by;
      }
      // Sempre "Administrador" na UI (não expor nome de super_admin como Franklin)
      const adminName = adminId ? 'Administrador' : null;

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
