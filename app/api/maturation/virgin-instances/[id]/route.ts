/**
 * API Route: /api/maturation/virgin-instances/[id]
 *
 * PATCH: Ações admin sobre instância em maturação virgem (pausar, forçar conclusão, reiniciar, bloquear)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: instanceId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profile?.status !== 'admin') {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (!['pause', 'resume', 'force_complete', 'restart', 'block'].includes(action)) {
      return errorResponse('action inválida. Use: pause, resume, force_complete, restart, block', 400);
    }

    const { data: instance, error: fetchError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, maturation_type, maturation_status, is_locked')
      .eq('id', instanceId)
      .single();

    if (fetchError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    if (instance.maturation_type !== 'virgem') {
      return errorResponse('Instância não é do tipo virgem', 400);
    }

    const now = new Date().toISOString();

    if (action === 'pause') {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({ maturation_paused_at: now, updated_at: now })
        .eq('id', instanceId);
      await supabaseServiceRole.from('virgin_maturation_logs').insert({
        evolution_instance_id: instanceId,
        event_type: 'admin_action',
        message: 'Maturação pausada pelo admin',
        payload_json: { action: 'pause' },
      });
      return successResponse({ ok: true, message: 'Maturação pausada' });
    }

    if (action === 'resume') {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({ maturation_paused_at: null, updated_at: now })
        .eq('id', instanceId);
      await supabaseServiceRole.from('virgin_maturation_logs').insert({
        evolution_instance_id: instanceId,
        event_type: 'admin_action',
        message: 'Maturação retomada pelo admin',
        payload_json: { action: 'resume' },
      });
      return successResponse({ ok: true, message: 'Maturação retomada' });
    }

    if (action === 'force_complete') {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({
          maturation_status: 'completed',
          is_locked: false,
          current_day: 5,
          maturation_paused_at: null,
          updated_at: now,
        })
        .eq('id', instanceId);
      await supabaseServiceRole.from('virgin_maturation_logs').insert({
        evolution_instance_id: instanceId,
        event_type: 'admin_action',
        message: 'Maturação forçada como concluída pelo admin',
        payload_json: { action: 'force_complete' },
      });
      return successResponse({ ok: true, message: 'Maturação concluída' });
    }

    if (action === 'restart') {
      const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await supabaseServiceRole
        .from('evolution_instances')
        .update({
          maturation_status: 'waiting_connection_test',
          maturation_started_at: now,
          maturation_ends_at: endsAt.toISOString(),
          maturation_phase_started_at: now,
          maturation_paused_at: null,
          current_day: 1,
          is_locked: true,
          updated_at: now,
        })
        .eq('id', instanceId);
      await supabaseServiceRole.from('virgin_maturation_logs').insert({
        evolution_instance_id: instanceId,
        event_type: 'admin_action',
        message: 'Maturação reiniciada pelo admin',
        payload_json: { action: 'restart' },
      });
      return successResponse({ ok: true, message: 'Maturação reiniciada' });
    }

    if (action === 'block') {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({ is_locked: true, updated_at: now })
        .eq('id', instanceId);
      await supabaseServiceRole.from('virgin_maturation_logs').insert({
        evolution_instance_id: instanceId,
        event_type: 'admin_action',
        message: 'Instância bloqueada manualmente pelo admin',
        payload_json: { action: 'block' },
      });
      return successResponse({ ok: true, message: 'Instância bloqueada' });
    }

    return errorResponse('action não implementada', 400);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
