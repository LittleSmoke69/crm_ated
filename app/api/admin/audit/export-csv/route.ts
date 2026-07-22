/**
 * GET /api/admin/audit/export-csv
 * Exporta saídas (resumo recent) como CSV: nome do grupo, telefone, data, etc.
 * Query params: date_from, date_to, banca_id, group_id (opcional), limit (max 5000)
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function escapeCsv(s: string): string {
  const t = String(s ?? '').replace(/"/g, '""');
  return t.includes(',') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
}

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'gerente']);
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from') || undefined;
    const dateTo = searchParams.get('date_to') || undefined;
    const bancaId = searchParams.get('banca_id') || undefined;
    const groupId = searchParams.get('group_id') || undefined;
    const groupNameQ = searchParams.get('group_name') || searchParams.get('q') || undefined;
    const instanceNameQ = searchParams.get('instance_name') || undefined;
    const limit = Math.min(5000, Math.max(1, parseInt(searchParams.get('limit') || '1000', 10)));

    let instanceIdsFilter: string[] | undefined;
    if (instanceNameQ?.trim()) {
      const { data: instRows } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id')
        .eq('instance_name', instanceNameQ.trim());
      instanceIdsFilter = (instRows || []).map((r: { id: string }) => r.id);
      if (instanceIdsFilter.length === 0) instanceIdsFilter = [''];
    }
    let groupIdsByName: string[] | undefined;
    if (groupNameQ?.trim()) {
      const { data: nameRows } = await supabaseServiceRole
        .from('audit_group_names')
        .select('group_id')
        .ilike('group_subject', `%${groupNameQ.trim()}%`);
      groupIdsByName = [...new Set((nameRows || []).map((r: any) => r.group_id))];
      if (groupIdsByName.length === 0) groupIdsByName = [''];
    }

    let query = supabaseServiceRole
      .from('group_participant_exits')
      .select('id, evolution_instance_id, group_id, phone, author, occurred_at', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (bancaId) query = query.eq('banca_id', bancaId);
    if (groupId) query = query.eq('group_id', groupId);
    if (instanceIdsFilter) query = query.in('evolution_instance_id', instanceIdsFilter);
    if (groupIdsByName) query = query.in('group_id', groupIdsByName);
    if (dateFrom) query = query.gte('occurred_at', dateFrom);
    if (dateTo) query = query.lte('occurred_at', dateTo);

    const { data: rows, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const data = (rows || []) as { evolution_instance_id?: string; group_id: string; phone: string; author?: string; occurred_at: string }[];
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

    const header = ['Nome do grupo', 'ID do grupo', 'Telefone', 'Autor', 'Data/Hora'];
    const lines = [header.map(escapeCsv).join(',')];
    for (const r of data) {
      const instanceName = instanceNames.get(r.evolution_instance_id!) || '';
      const groupSubject = nameByKey.get(`${r.group_id}|${instanceName}`) ?? '';
      const dateStr = r.occurred_at ? new Date(r.occurred_at).toLocaleString('pt-BR') : '';
      lines.push([groupSubject, r.group_id, r.phone, r.author ?? '', dateStr].map(escapeCsv).join(','));
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="auditoria-saidas-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao exportar' }), { status: 401 });
  }
}
