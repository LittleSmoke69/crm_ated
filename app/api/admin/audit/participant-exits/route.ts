/**
 * GET /api/admin/audit/participant-exits
 * Consulta auditoria de saídas de participantes (group-participants.update action: remove).
 * Acesso: super_admin, admin, dono_banca, gerente, auditoria.
 *
 * Query params:
 * - banca_id: filtrar por banca (UUID)
 * - group_id: filtrar por grupo (JID)
 * - date_from: início do período (ISO ou YYYY-MM-DD)
 * - date_to: fim do período (ISO ou YYYY-MM-DD)
 * - list: 'recent' | 'unique_phones' | 'groups_evasion'
 * - page, limit: paginação
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type ListMode = 'recent' | 'unique_phones' | 'groups_evasion';

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'dono_banca', 'gerente', 'auditoria']);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id') || undefined;
    const groupId = searchParams.get('group_id') || undefined;
    const groupNameQ = searchParams.get('group_name') || searchParams.get('q') || undefined;
    const dateFrom = searchParams.get('date_from') || undefined;
    const dateTo = searchParams.get('date_to') || undefined;
    const list = (searchParams.get('list') as ListMode) || 'recent';
    let groupIdsByName: string[] | undefined;
    if (groupNameQ && groupNameQ.trim()) {
      const { data: nameRows } = await supabaseServiceRole
        .from('audit_group_names')
        .select('group_id')
        .ilike('group_subject', `%${groupNameQ.trim()}%`);
      groupIdsByName = [...new Set((nameRows || []).map((r: any) => r.group_id))];
      if (groupIdsByName.length === 0) groupIdsByName = [''];
    }
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (list === 'unique_phones') {
      // Lista estratégica: telefones únicos que já saíram (com contagem e última saída)
      let query = supabaseServiceRole
        .from('group_participant_exits')
        .select('phone, occurred_at', { count: 'exact' });

      if (bancaId) query = query.eq('banca_id', bancaId);
      if (groupId) query = query.eq('group_id', groupId);
      if (groupIdsByName) query = query.in('group_id', groupIdsByName);
      if (dateFrom) query = query.gte('occurred_at', dateFrom);
      if (dateTo) query = query.lte('occurred_at', dateTo);

      const { data: rows, error } = await query.order('occurred_at', { ascending: false });

      if (error) {
        return errorResponse(error.message, 500);
      }

      const byPhone = new Map<string, { count: number; last_at: string }>();
      for (const r of rows || []) {
        const existing = byPhone.get(r.phone);
        if (!existing) {
          byPhone.set(r.phone, { count: 1, last_at: r.occurred_at });
        } else {
          existing.count += 1;
          if (r.occurred_at > existing.last_at) existing.last_at = r.occurred_at;
        }
      }
      const sorted = Array.from(byPhone.entries())
        .map(([phone, meta]) => ({ phone, exit_count: meta.count, last_exit_at: meta.last_at }))
        .sort((a, b) => (b.last_exit_at > a.last_exit_at ? 1 : -1));
      const total = sorted.length;
      const totalPages = Math.ceil(total / limit);
      const data = sorted.slice(from, to + 1);

      return successResponse(data, {
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    if (list === 'groups_evasion') {
      // Lista estratégica: grupos com maior evasão (contagem de saídas)
      let query = supabaseServiceRole
        .from('group_participant_exits')
        .select('group_id, occurred_at', { count: 'exact' });

      if (bancaId) query = query.eq('banca_id', bancaId);
      if (groupId) query = query.eq('group_id', groupId);
      if (groupIdsByName) query = query.in('group_id', groupIdsByName);
      if (dateFrom) query = query.gte('occurred_at', dateFrom);
      if (dateTo) query = query.lte('occurred_at', dateTo);

      const { data: rows, error } = await query.order('occurred_at', { ascending: false });

      if (error) {
        return errorResponse(error.message, 500);
      }

      const byGroup = new Map<string, number>();
      for (const r of rows || []) {
        byGroup.set(r.group_id, (byGroup.get(r.group_id) || 0) + 1);
      }
      const sorted = Array.from(byGroup.entries())
        .map(([group_id, exit_count]) => ({ group_id, exit_count }))
        .sort((a, b) => b.exit_count - a.exit_count);
      const total = sorted.length;
      const totalPages = Math.ceil(total / limit);
      const data = sorted.slice(from, to + 1);

      return successResponse(data, {
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    // list=recent ou padrão: registros de saída com filtros e paginação
    let query = supabaseServiceRole
      .from('group_participant_exits')
      .select(
        'id, evolution_instance_id, banca_id, group_id, phone, action, event_type, author, occurred_at, created_at',
        { count: 'exact' }
      );

    if (bancaId) query = query.eq('banca_id', bancaId);
    if (groupId) query = query.eq('group_id', groupId);
    if (groupIdsByName) query = query.in('group_id', groupIdsByName);
    if (dateFrom) query = query.gte('occurred_at', dateFrom);
    if (dateTo) query = query.lte('occurred_at', dateTo);

    query = query.order('occurred_at', { ascending: false }).range(from, to);

    const { data: rows, error, count } = await query;

    if (error) {
      return errorResponse(error.message, 500);
    }

    const data = (rows || []) as { evolution_instance_id?: string; group_id: string; [k: string]: any }[];
    const instanceIds = [...new Set(data.map((r) => r.evolution_instance_id).filter(Boolean))] as string[];
    const instanceNames = new Map<string, string>();
    if (instanceIds.length > 0) {
      const { data: inst } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name')
        .in('id', instanceIds);
      (inst || []).forEach((i: any) => instanceNames.set(i.id, i.instance_name || ''));
    }
    const groupIds = [...new Set(data.map((r) => r.group_id))];
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
    const enriched = data.map((r) => {
      const instanceName = instanceNames.get(r.evolution_instance_id ?? '') || '';
      const key = `${r.group_id}|${instanceName}`;
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
    return errorResponse(err.message || 'Erro ao consultar auditoria', 401);
  }
}
