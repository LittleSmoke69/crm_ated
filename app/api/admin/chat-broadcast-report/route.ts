/**
 * GET /api/admin/chat-broadcast-report
 *
 * Relatório de Disparo em Massa do chat de atendimento (tabela chat_broadcasts):
 *  - summary: total de jobs, total de mensagens enviadas (estimativa por job),
 *    instâncias usadas, usuários distintos, breakdown por status.
 *  - byUser: jobs e mensagens por dono do disparo.
 *  - byInstance: jobs e mensagens por instância Evolution (considera todas as
 *    instâncias de cada job em `broadcast_instances`; cai para `instance_id`
 *    quando o array está vazio — formato legado).
 *
 * Query: from=YYYY-MM-DD, to=YYYY-MM-DD, all=1 (ignora filtro de data; default
 * é últimos 30 dias).
 *
 * Acesso: requireAdmin (super_admin / admin / cargos com painel_admin).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { parseBroadcastSteps } from '@/lib/chat/broadcast-sequence';

export const runtime = 'nodejs';

type BroadcastInstanceRef = { id: string; name?: string };

type BroadcastRow = {
  id: string;
  user_id: string;
  instance_id: string | null;
  instance_name: string | null;
  broadcast_instances: BroadcastInstanceRef[] | null;
  message_config: unknown;
  total_count: number | null;
  current_index: number | null;
  message_step_index: number | null;
  status: string;
  created_at: string;
};

type StatusBreakdown = Record<string, number>;

type UserAgg = {
  user_id: string;
  user_name: string;
  jobs_count: number;
  messages_sent: number;
  contacts_total: number;
  by_status: StatusBreakdown;
};

type InstanceAgg = {
  instance_id: string;
  instance_name: string;
  jobs_count: number;
  messages_sent: number;
};

/**
 * Total de mensagens efetivamente enviadas em um job.
 * Cada contato em [0, current_index) consumiu todos os steps;
 * o contato em current_index pode ter recebido parcialmente (message_step_index).
 */
function messagesSentForJob(row: BroadcastRow): number {
  const stepsTotal = Math.max(1, parseBroadcastSteps(row.message_config).length);
  const completedContacts = Math.max(0, Number(row.current_index) || 0);
  const partialSteps = Math.max(0, Number(row.message_step_index) || 0);
  const totalContacts = Math.max(0, Number(row.total_count) || 0);
  const safeCompleted = Math.min(completedContacts, totalContacts);
  return safeCompleted * stepsTotal + (safeCompleted < totalContacts ? partialSteps : 0);
}

/** IDs únicos de instâncias usadas pelo job (rotação ou fallback legado). */
function instancesOfJob(row: BroadcastRow): BroadcastInstanceRef[] {
  const rotation = Array.isArray(row.broadcast_instances) ? row.broadcast_instances : null;
  if (rotation && rotation.length > 0) {
    const seen = new Set<string>();
    const out: BroadcastInstanceRef[] = [];
    for (const r of rotation) {
      const id = r?.id ? String(r.id) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: r?.name });
    }
    return out;
  }
  if (row.instance_id) {
    return [{ id: String(row.instance_id), name: row.instance_name ?? undefined }];
  }
  return [];
}

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
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const allParam = searchParams.get('all');
    const isAll = allParam === '1' || allParam === 'true';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    let fromIso: string | null = null;
    let toIso: string | null = null;
    let fromOut: string | null = null;
    let toOut: string | null = null;

    if (!isAll) {
      const defaults = defaultDateRange();
      const fromDate = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : defaults.from;
      const toDate = toParam ? new Date(`${toParam}T23:59:59.999Z`) : defaults.to;
      fromIso = fromDate.toISOString();
      toIso = toDate.toISOString();
      fromOut = fromDate.toISOString().slice(0, 10);
      toOut = toDate.toISOString().slice(0, 10);
    }

    let query = supabaseServiceRole
      .from('chat_broadcasts')
      .select(
        'id, user_id, instance_id, instance_name, broadcast_instances, message_config, total_count, current_index, message_step_index, status, created_at'
      )
      .order('created_at', { ascending: false });

    if (!isAll && fromIso && toIso) {
      query = query.gte('created_at', fromIso).lte('created_at', toIso);
    }

    const { data: rowsRaw, error } = await query;
    if (error) return serverErrorResponse(error);

    const rows = (rowsRaw || []) as BroadcastRow[];

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    const instanceIdsAll = new Set<string>();
    for (const r of rows) {
      for (const inst of instancesOfJob(r)) {
        instanceIdsAll.add(inst.id);
      }
    }

    const [profilesRes, instancesRes] = await Promise.all([
      userIds.length > 0
        ? supabaseServiceRole
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; full_name?: string; email?: string }[] }),
      instanceIdsAll.size > 0
        ? supabaseServiceRole
            .from('evolution_instances')
            .select('id, instance_name')
            .in('id', [...instanceIdsAll])
        : Promise.resolve({ data: [] as { id: string; instance_name?: string }[] }),
    ]);

    const userName = new Map<string, string>();
    for (const p of (profilesRes.data ?? []) as { id: string; full_name?: string; email?: string }[]) {
      userName.set(p.id, p.full_name?.trim() || p.email || p.id);
    }
    const instanceName = new Map<string, string>();
    for (const i of (instancesRes.data ?? []) as { id: string; instance_name?: string }[]) {
      instanceName.set(i.id, i.instance_name || i.id);
    }

    const byStatus: StatusBreakdown = {};
    let totalMessagesSent = 0;
    let totalContacts = 0;

    const userMap = new Map<string, UserAgg>();
    const instanceMap = new Map<string, InstanceAgg>();

    for (const r of rows) {
      const status = String(r.status || '—');
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      const msgs = messagesSentForJob(r);
      const contacts = Number(r.total_count) || 0;
      totalMessagesSent += msgs;
      totalContacts += contacts;

      const uid = r.user_id;
      if (uid) {
        let u = userMap.get(uid);
        if (!u) {
          u = {
            user_id: uid,
            user_name: userName.get(uid) || uid,
            jobs_count: 0,
            messages_sent: 0,
            contacts_total: 0,
            by_status: {},
          };
          userMap.set(uid, u);
        }
        u.jobs_count += 1;
        u.messages_sent += msgs;
        u.contacts_total += contacts;
        u.by_status[status] = (u.by_status[status] ?? 0) + 1;
      }

      // Atribui as msgs do job a cada instância participante (proporcional).
      const instances = instancesOfJob(r);
      const share = instances.length > 0 ? Math.round(msgs / instances.length) : 0;
      const lastShare = instances.length > 0 ? msgs - share * (instances.length - 1) : 0;
      instances.forEach((inst, idx) => {
        let entry = instanceMap.get(inst.id);
        if (!entry) {
          entry = {
            instance_id: inst.id,
            instance_name: instanceName.get(inst.id) || inst.name || inst.id,
            jobs_count: 0,
            messages_sent: 0,
          };
          instanceMap.set(inst.id, entry);
        }
        entry.jobs_count += 1;
        entry.messages_sent += idx === instances.length - 1 ? lastShare : share;
      });
    }

    const byUser = [...userMap.values()].sort((a, b) => b.jobs_count - a.jobs_count);
    const byInstance = [...instanceMap.values()].sort((a, b) => b.jobs_count - a.jobs_count);

    return successResponse({
      period: isAll ? null : { from: fromOut, to: toOut },
      summary: {
        totalJobs: rows.length,
        totalMessagesSent,
        totalContacts,
        usersCount: userMap.size,
        instancesCount: instanceMap.size,
        byStatus,
      },
      byUser,
      byInstance,
    });
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
