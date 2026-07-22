/**
 * POST /api/admin/audit/group-names/sync-background
 * Cria jobs na fila para processamento em segundo plano pelo scheduler Netlify.
 * Retorna imediatamente (evita timeout em consultas grandes).
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function POST(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin']);

    const pairs = new Map<string, { group_id: string; instance_name: string }>();

    const { data: exits } = await supabaseServiceRole
      .from('group_participant_exits')
      .select('group_id, evolution_instance_id');
    const instanceIds = [...new Set((exits || []).map((r: any) => r.evolution_instance_id).filter(Boolean))];
    const instanceMap = new Map<string, string>();
    if (instanceIds.length > 0) {
      const { data: inst } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name')
        .in('id', instanceIds);
      (inst || []).forEach((i: any) => instanceMap.set(i.id, i.instance_name || ''));
    }
    (exits || []).forEach((r: any) => {
      const instanceName = instanceMap.get(r.evolution_instance_id) || '';
      if (r.group_id && instanceName) {
        const key = `${r.group_id}|${instanceName}`;
        if (!pairs.has(key)) pairs.set(key, { group_id: r.group_id, instance_name: instanceName });
      }
    });

    const { data: raw } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('instance_name, payload')
      .eq('event_type', 'group-participants.update')
      .limit(2000);
    (raw || []).forEach((r: any) => {
      const instanceName = r.instance_name || '';
      const groupId = r.payload?.data?.id ?? r.payload?.data?.key?.remoteJid ?? r.payload?.data?.groupJid ?? '';
      if (groupId && instanceName) {
        const key = `${groupId}|${instanceName}`;
        if (!pairs.has(key)) pairs.set(key, { group_id: groupId, instance_name: instanceName });
      }
    });

    const list = Array.from(pairs.values());
    const byInstance = new Map<string, string[]>();
    list.forEach((p) => {
      const arr = byInstance.get(p.instance_name) || [];
      if (!arr.includes(p.group_id)) arr.push(p.group_id);
      byInstance.set(p.instance_name, arr);
    });

    const jobs = Array.from(byInstance.entries())
      .filter(([, jids]) => jids.length > 0)
      .map(([instance_name, groupJids]) => ({
        instance_name,
        group_jids: groupJids,
        status: 'pending',
        processed_count: 0,
      }));

    if (jobs.length === 0) {
      return successResponse({ message: 'Nenhum grupo para sincronizar', jobsCreated: 0 });
    }

    const { data: inserted, error } = await supabaseServiceRole
      .from('audit_group_names_sync_jobs')
      .insert(jobs)
      .select('id');

    if (error) return errorResponse(error.message || 'Erro ao criar jobs', 500);

    return successResponse({
      message: 'Sincronização iniciada em segundo plano. O processo continuará automaticamente.',
      jobsCreated: (inserted || []).length,
      totalPairs: list.length,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao iniciar sync', 401);
  }
}
