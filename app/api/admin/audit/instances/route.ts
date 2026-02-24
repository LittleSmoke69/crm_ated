/**
 * GET /api/admin/audit/instances
 * Retorna lista de instance_name: evolution_instances ativas + distinct de evolution_webhook_events.
 * Acesso: super_admin, admin, dono_banca, gerente, auditoria.
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'dono_banca', 'gerente', 'auditoria']);

    const set = new Set<string>();

    const { data: inst } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name')
      .eq('is_active', true)
      .not('instance_name', 'is', null);
    (inst || []).forEach((r: { instance_name: string }) => {
      if (r.instance_name?.trim()) set.add(r.instance_name.trim());
    });

    const { data: events } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('instance_name')
      .eq('event_type', 'group-participants.update')
      .not('instance_name', 'is', null)
      .limit(5000);
    (events || []).forEach((r: { instance_name: string }) => {
      if (r.instance_name?.trim()) set.add(r.instance_name.trim());
    });

    const names = Array.from(set).sort();
    return successResponse(names);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao listar instâncias', 401);
  }
}
