/**
 * GET /api/admin/chat-operations-report
 * Relatório operacional: banca (via gerente) → gerente → instâncias Evolution com consultor vinculado,
 * contagem de conversas e volume de mensagens no período.
 * Acesso: super_admin, admin (tenant), gerente (apenas próprios vínculos).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeConsultorUserIdsColumn } from '@/lib/utils/atendimento-consultores';

type AssignmentRow = {
  id: string;
  evolution_instance_id: string;
  gerente_user_id: string;
  consultor_user_ids: unknown;
  evolution_instances: { id: string; instance_name: string; status: string } | null;
};

function defaultDateRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile, error: profErr } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id, full_name, email')
      .eq('id', userId)
      .single();

    if (profErr || !profile) {
      return errorResponse('Perfil não encontrado', 404);
    }

    const st = (profile.status || '').toLowerCase();
    const isSuper = st === 'super_admin';
    const isAdmin = st === 'admin';
    const isGerente = st === 'gerente';

    if (!isSuper && !isAdmin && !isGerente) {
      return errorResponse('Acesso negado.', 403);
    }

    const { searchParams } = new URL(req.url);
    let fromDate = searchParams.get('from');
    let toDate = searchParams.get('to');
    const defaults = defaultDateRange();
    if (!fromDate) {
      fromDate = defaults.from.toISOString().slice(0, 10);
    }
    if (!toDate) {
      toDate = defaults.to.toISOString().slice(0, 10);
    }

    const fromIso = `${fromDate}T00:00:00.000Z`;
    const toIso = `${toDate}T23:59:59.999Z`;

    let assignQuery = supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select(
        `
        id,
        evolution_instance_id,
        gerente_user_id,
        consultor_user_ids,
        evolution_instances ( id, instance_name, status )
      `
      )
      .order('created_at', { ascending: false });

    if (isGerente) {
      assignQuery = assignQuery.eq('gerente_user_id', userId);
    } else if (isAdmin && profile.zaploto_id) {
      const { data: gerentesTenant } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('status', 'gerente')
        .eq('zaploto_id', profile.zaploto_id);

      const gids = (gerentesTenant || []).map((g: { id: string }) => g.id);
      if (gids.length === 0) {
        return successResponse({
          period: { from: fromDate, to: toDate },
          byBanca: [],
          summary: {
            assignments: 0,
            instances: 0,
            conversationsTotal: 0,
            conversationsResolved: 0,
            messagesInPeriod: 0,
          },
        });
      }
      assignQuery = assignQuery.in('gerente_user_id', gids);
    }

    const { data: assignments, error: aErr } = await assignQuery;

    if (aErr) {
      console.error('[chat-operations-report] assignments', aErr.message);
      return errorResponse(`Erro ao listar vínculos: ${aErr.message}`, 500);
    }

    const rows = (assignments || []) as unknown as AssignmentRow[];
    if (rows.length === 0) {
      return successResponse({
        period: { from: fromDate, to: toDate },
        byBanca: [],
        summary: {
          assignments: 0,
          instances: 0,
          conversationsTotal: 0,
          conversationsResolved: 0,
          messagesInPeriod: 0,
        },
      });
    }

    const gerenteIds = [...new Set(rows.map((r) => r.gerente_user_id))];
    const consultorIds = [
      ...new Set(rows.flatMap((r) => normalizeConsultorUserIdsColumn(r.consultor_user_ids))),
    ];

    const { data: gerenteProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', gerenteIds);

    const gerenteName = new Map(
      (gerenteProfiles || []).map((p: { id: string; full_name?: string; email?: string }) => [
        p.id,
        p.full_name || p.email || p.id,
      ])
    );

    let consultorName = new Map<string, string>();
    if (consultorIds.length > 0) {
      const { data: cp } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultorIds);
      consultorName = new Map(
        (cp || []).map((p: { id: string; full_name?: string; email?: string }) => [
          p.id,
          p.full_name || p.email || p.id,
        ])
      );
    }

    const { data: ubRows } = await supabaseServiceRole
      .from('user_bancas')
      .select('user_id, banca_ids')
      .in('user_id', gerenteIds);

    const bancaIdsNeeded = new Set<string>();
    const gerenteToBancaIds = new Map<string, string[]>();
    for (const row of ubRows || []) {
      const uid = row.user_id as string;
      const ids = Array.isArray(row.banca_ids) ? (row.banca_ids as string[]) : [];
      gerenteToBancaIds.set(uid, ids);
      ids.forEach((id) => bancaIdsNeeded.add(id));
    }

    let bancaNameById = new Map<string, string>();
    if (bancaIdsNeeded.size > 0) {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name')
        .in('id', [...bancaIdsNeeded]);
      bancaNameById = new Map(
        (bancas || []).map((b: { id: string; name: string }) => [b.id, b.name || b.id])
      );
    }

    const instanceIds = [...new Set(rows.map((r) => r.evolution_instance_id))];

    const { data: convRows } = await supabaseServiceRole
      .from('chat_conversations')
      .select('instance_id, attendance_status')
      .in('instance_id', instanceIds);

    const convByInstance = new Map<
      string,
      { total: number; resolved: number; open: number }
    >();
    for (const instId of instanceIds) {
      convByInstance.set(instId, { total: 0, resolved: 0, open: 0 });
    }
    for (const c of convRows || []) {
      const iid = (c as { instance_id?: string }).instance_id;
      if (!iid || !convByInstance.has(iid)) continue;
      const rec = convByInstance.get(iid)!;
      rec.total += 1;
      const status = String((c as { attendance_status?: string }).attendance_status || '').toLowerCase();
      if (status === 'resolvido') {
        rec.resolved += 1;
      } else {
        rec.open += 1;
      }
    }

    let messageCounts = new Map<string, number>();
    try {
      const { data: rpcData, error: rpcErr } = await supabaseServiceRole.rpc('chat_message_counts_by_instance', {
        p_instance_ids: instanceIds,
        p_from: fromIso,
        p_to: toIso,
      });

      if (rpcErr) {
        console.warn('[chat-operations-report] rpc chat_message_counts_by_instance:', rpcErr.message);
      } else if (Array.isArray(rpcData)) {
        for (const row of rpcData as { instance_id: string; msg_count: number }[]) {
          if (row.instance_id) {
            messageCounts.set(row.instance_id, Number(row.msg_count) || 0);
          }
        }
      }
    } catch (e) {
      console.warn('[chat-operations-report] rpc failed', e);
    }

    type InstanceRow = {
      assignment_id: string;
      instance_id: string;
      instance_name: string;
      instance_status: string;
      /** Primeiro consultor (compat.) */
      consultor_id: string | null;
      consultor_name: string | null;
      consultores: { id: string; name: string }[];
      conversations_total: number;
      conversations_resolved: number;
      conversations_open: number;
      messages_in_period: number;
    };

    type GerenteBlock = {
      gerente_id: string;
      gerente_name: string;
      instances: InstanceRow[];
    };

    type BancaBlock = {
      banca_id: string;
      banca_name: string;
      gerentes: GerenteBlock[];
    };

    const bancaMap = new Map<string, BancaBlock>();

    function ensureBanca(bancaId: string, bancaName: string): BancaBlock {
      let b = bancaMap.get(bancaId);
      if (!b) {
        b = { banca_id: bancaId, banca_name: bancaName, gerentes: [] };
        bancaMap.set(bancaId, b);
      }
      return b;
    }

    function ensureGerente(b: BancaBlock, gid: string, gname: string): GerenteBlock {
      let g = b.gerentes.find((x) => x.gerente_id === gid);
      if (!g) {
        g = { gerente_id: gid, gerente_name: gname, instances: [] };
        b.gerentes.push(g);
      }
      return g;
    }

    const NO_BANCA = '__sem_banca__';

    for (const r of rows) {
      const gid = r.gerente_user_id;
      const gname = gerenteName.get(gid) || gid;
      const inst = r.evolution_instances;
      const iid = r.evolution_instance_id;
      const conv = convByInstance.get(iid) || { total: 0, resolved: 0, open: 0 };
      const cids = normalizeConsultorUserIdsColumn(r.consultor_user_ids);
      const consultores = cids.map((id) => ({ id, name: consultorName.get(id) || id }));
      const instanceRow: InstanceRow = {
        assignment_id: r.id,
        instance_id: iid,
        instance_name: inst?.instance_name || iid,
        instance_status: inst?.status || '—',
        consultor_id: cids[0] ?? null,
        consultor_name:
          cids.length === 0
            ? null
            : cids.length === 1
              ? consultorName.get(cids[0]) || cids[0]
              : `${cids.length} consultores`,
        consultores,
        conversations_total: conv.total,
        conversations_resolved: conv.resolved,
        conversations_open: conv.open,
        messages_in_period: messageCounts.get(iid) || 0,
      };

      const bancaList = gerenteToBancaIds.get(gid) || [];
      const primaryBancaId = bancaList.length > 0 ? bancaList[0] : NO_BANCA;
      const primaryBancaName =
        primaryBancaId === NO_BANCA
          ? 'Sem banca definida'
          : bancaNameById.get(primaryBancaId) || primaryBancaId;

      const b = ensureBanca(primaryBancaId, primaryBancaName);
      const g = ensureGerente(b, gid, gname);
      g.instances.push(instanceRow);
    }

    const byBanca = [...bancaMap.values()].sort((a, b) =>
      a.banca_name.localeCompare(b.banca_name, 'pt-BR')
    );
    for (const b of byBanca) {
      b.gerentes.sort((a, c) => a.gerente_name.localeCompare(c.gerente_name, 'pt-BR'));
      for (const g of b.gerentes) {
        g.instances.sort((a, c) => a.instance_name.localeCompare(c.instance_name, 'pt-BR'));
      }
    }

    let messagesInPeriod = 0;
    for (const v of messageCounts.values()) {
      messagesInPeriod += v;
    }
    let conversationsTotal = 0;
    let conversationsResolved = 0;
    for (const v of convByInstance.values()) {
      conversationsTotal += v.total;
      conversationsResolved += v.resolved;
    }

    return successResponse({
      period: { from: fromDate, to: toDate },
      byBanca,
      summary: {
        assignments: rows.length,
        instances: instanceIds.length,
        conversationsTotal,
        conversationsResolved,
        messagesInPeriod,
      },
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
