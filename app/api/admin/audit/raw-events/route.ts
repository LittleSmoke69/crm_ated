/**
 * GET /api/admin/audit/raw-events
 * Lista eventos brutos group-participants.update (evolution_webhook_events).
 * Acesso: super_admin, admin, auditoria.
 *
 * Query params:
 * - env: 'prod' | 'test'
 * - date_from, date_to: período (received_at)
 * - action: 'add' | 'remove' (filtra pelo payload)
 * - page, limit
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const EVENT_TYPE = 'group-participants.update';

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'auditoria']);
    const { searchParams } = req.nextUrl;

    const env = searchParams.get('env') || undefined;
    const dateFrom = searchParams.get('date_from') || undefined;
    const dateTo = searchParams.get('date_to') || undefined;
    const actionFilter = searchParams.get('action') || undefined; // 'add' | 'remove'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, received_at, env, event_type, instance_name, remote_jid, payload', { count: 'exact' })
      .eq('event_type', EVENT_TYPE);

    if (env && (env === 'prod' || env === 'test')) {
      query = query.eq('env', env);
    }
    if (dateFrom) {
      query = query.gte('received_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('received_at', dateTo);
    }
    if (actionFilter === 'add' || actionFilter === 'remove') {
      query = query.filter('payload->data->>action', 'eq', actionFilter);
    }

    query = query.order('received_at', { ascending: false }).range(from, to);

    const { data: rows, error, count } = await query;

    if (error) {
      return errorResponse(error.message, 500);
    }

    const getAction = (p: any): 'add' | 'remove' | null => {
      const a = p?.data?.action ?? p?.action ?? null;
      if (a === 'add' || a === 'remove') return a;
      return null;
    };
    const getGroupId = (p: any): string =>
      p?.data?.id ?? p?.data?.key?.remoteJid ?? p?.data?.groupJid ?? p?.remote_jid ?? '';
    const getPhone = (p: any): string => {
      const raw =
        p?.data?.participants?.[0]?.phoneNumber ??
        p?.data?.participants?.[0]?.id ??
        p?.participants?.[0]?.phoneNumber ??
        '';
      return String(raw).replace(/@s\.whatsapp\.net/i, '').replace(/\D/g, '').trim() || String(raw);
    };

    const list = (rows || []).map((r: any) => ({
      id: r.id,
      received_at: r.received_at,
      env: r.env,
      event_type: r.event_type,
      instance_name: r.instance_name,
      remote_jid: r.remote_jid,
      action: getAction(r.payload),
      group_id: getGroupId(r.payload),
      phone: getPhone(r.payload),
      payload: r.payload,
    }));

    const pairs = list.map((r) => ({ group_id: r.group_id, instance_name: r.instance_name || '' })).filter((p) => p.group_id);
    const groupIds = [...new Set(pairs.map((p) => p.group_id))];
    const nameByKey = new Map<string, string>();
    if (groupIds.length > 0) {
      const { data: names } = await supabaseServiceRole
        .from('audit_group_names')
        .select('group_id, instance_name, group_subject')
        .in('group_id', groupIds);
      for (const n of names || []) {
        nameByKey.set(`${n.group_id}|${n.instance_name}`, n.group_subject || '');
      }
    }
    const enriched = list.map((r) => {
      const key = `${r.group_id}|${r.instance_name || ''}`;
      return { ...r, group_subject: nameByKey.get(key) ?? null };
    });

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return successResponse(enriched, {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar eventos', 401);
  }
}
