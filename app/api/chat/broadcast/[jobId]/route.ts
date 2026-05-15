/**
 * /api/chat/broadcast/[jobId]
 *
 * GET   → detalhes do broadcast
 * PATCH → status (pause, resume, cancel) **ou** edição da campanha (pendente/pausado)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  parseBroadcastSteps,
  wrapMessageConfigForInsert,
  type BroadcastStepConfig,
} from '@/lib/chat/broadcast-sequence';
import {
  BROADCAST_DEFAULT_RANDOM_MAX_SEC,
  BROADCAST_DEFAULT_RANDOM_MIN_SEC,
} from '@/lib/chat/broadcast-delay';
import { normalizeBroadcastPhoneDigits } from '@/lib/chat/broadcast-phone';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { jobId } = await params;

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (error || !data) return errorResponse('Broadcast não encontrado', 404);
    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

type PatchBody = {
  status?: 'running' | 'paused' | 'cancelled';
  title?: string;
  message_steps?: BroadcastStepConfig[];
  sequence_delay_seconds?: number;
  rotation_size?: number;
  contacts?: { phone?: string; name?: string }[];
  delay_mode?: 'fixed' | 'random';
  delay_seconds?: number;
  delay_min_seconds?: number;
  delay_max_seconds?: number;
  instance_ids?: string[];
};

function bodyHasCampaignEdit(body: PatchBody): boolean {
  return (
    body.title !== undefined ||
    Array.isArray(body.message_steps) ||
    Array.isArray(body.contacts) ||
    Array.isArray(body.instance_ids) ||
    body.delay_mode !== undefined ||
    body.delay_seconds !== undefined ||
    body.delay_min_seconds !== undefined ||
    body.delay_max_seconds !== undefined ||
    body.sequence_delay_seconds !== undefined ||
    body.rotation_size !== undefined
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { jobId } = await params;
    const body = (await req.json()) as PatchBody;

    const hasStatus = body.status !== undefined && body.status !== null;
    const hasEdit = bodyHasCampaignEdit(body);

    if (hasStatus && hasEdit) {
      return errorResponse('Envie apenas status (pause/retomar/cancelar) ou apenas os dados da campanha para editar.', 400);
    }

    if (hasEdit) {
      const { data: current, error: curErr } = await supabaseServiceRole
        .from('chat_broadcasts')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single();

      if (curErr || !current) return errorResponse('Broadcast não encontrado', 404);
      if (current.status !== 'pending' && current.status !== 'paused') {
        return errorResponse('Só é possível editar campanhas pendentes ou pausadas.', 400);
      }

      if (!Array.isArray(body.message_steps) || body.message_steps.length === 0) {
        return errorResponse('Informe message_steps com ao menos uma mensagem', 400);
      }
      if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
        return errorResponse('contacts não pode ser vazio', 400);
      }
      if (!Array.isArray(body.instance_ids) || body.instance_ids.length === 0) {
        return errorResponse('Informe ao menos uma instância (instance_ids)', 400);
      }

      const steps = body.message_steps.filter((s) => s && typeof s.type === 'string');
      if (steps.length === 0) return errorResponse('message_steps inválido', 400);

      const delayMode: 'fixed' | 'random' = body.delay_mode === 'random' ? 'random' : 'fixed';
      let delaySecondsStored = Math.min(7200, Math.max(10, Math.floor(Number(body.delay_seconds) || 120)));
      let delayMin: number | null = null;
      let delayMax: number | null = null;

      if (delayMode === 'random') {
        let lo = Math.max(
          1,
          Math.min(7200, Math.floor(Number(body.delay_min_seconds) || BROADCAST_DEFAULT_RANDOM_MIN_SEC))
        );
        let hi = Math.max(
          1,
          Math.min(7200, Math.floor(Number(body.delay_max_seconds) || BROADCAST_DEFAULT_RANDOM_MAX_SEC))
        );
        if (lo > hi) [lo, hi] = [hi, lo];
        delayMin = lo;
        delayMax = hi;
        delaySecondsStored = hi;
      }

      const seqDelay = Math.min(7200, Math.max(1, Math.floor(Number(body.sequence_delay_seconds) || 15)));
      const rotationSize = Math.min(9999, Math.max(1, Math.floor(Number(body.rotation_size) || 1)));
      const message_config_stored = wrapMessageConfigForInsert(steps, seqDelay, rotationSize);

      const validContacts = body.contacts
        .map((c) => {
          const digits = String(c?.phone ?? '').replace(/\D/g, '');
          return {
            phone: normalizeBroadcastPhoneDigits(digits),
            name: typeof c?.name === 'string' ? c.name : undefined,
          };
        })
        .filter((c) => c.phone.length >= 8);

      if (validContacts.length === 0) return errorResponse('Nenhum contato com telefone válido', 400);

      const uniqueIds = [...new Set(body.instance_ids!.map((x) => String(x).trim()).filter(Boolean))];

      const { data: profile } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', userId)
        .single();

      const isAdmin =
        profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'suporte';

      const { data: instances, error: instErr } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, user_id')
        .in('id', uniqueIds);

      if (instErr || !instances || instances.length !== uniqueIds.length) {
        return errorResponse('Uma ou mais instâncias não foram encontradas', 400);
      }

      for (const inst of instances) {
        if (!isAdmin && inst.user_id !== userId) {
          return errorResponse('Acesso negado a uma das instâncias', 403);
        }
      }

      const orderMap = new Map(uniqueIds.map((id, i) => [id, i]));
      const sorted = [...instances].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      const broadcast_instances = sorted.map((r) => ({ id: r.id, name: r.instance_name }));
      const primary = sorted[0];

      let currentIndex = Number(current.current_index) || 0;
      if (currentIndex > validContacts.length) currentIndex = validContacts.length;

      let messageStepIndex = Number(current.message_step_index) || 0;
      if (!Number.isFinite(messageStepIndex) || messageStepIndex < 0) messageStepIndex = 0;
      if (steps.length > 0 && messageStepIndex >= steps.length) messageStepIndex = 0;

      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : String(current.title || 'Disparo');

      const updates: Record<string, unknown> = {
        title,
        instance_id: primary.id,
        instance_name: primary.instance_name,
        broadcast_instances,
        message_config: message_config_stored,
        contacts: validContacts,
        total_count: validContacts.length,
        current_index: currentIndex,
        message_step_index: messageStepIndex,
        delay_seconds: delaySecondsStored,
        delay_mode: delayMode,
        delay_min_seconds: delayMode === 'random' ? delayMin : null,
        delay_max_seconds: delayMode === 'random' ? delayMax : null,
        step_claim_token: null,
        step_claim_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseServiceRole
        .from('chat_broadcasts')
        .update(updates)
        .eq('id', jobId)
        .select(
          'id, title, instance_name, total_count, current_index, message_step_index, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds, broadcast_instances, status, created_at, message_config'
        )
        .single();

      if (error) return errorResponse(error.message, 500);
      const row = data as Record<string, unknown>;
      const mc = row.message_config;
      return successResponse(
        {
          ...row,
          message_steps_count: parseBroadcastSteps(mc).length,
          rotation_size: rotationSize,
        },
        'Campanha atualizada'
      );
    }

    if (!hasStatus) {
      return errorResponse('Informe status ou dados completos da campanha para edição', 400);
    }

    const allowed = ['running', 'paused', 'cancelled'];
    if (!allowed.includes(body.status!)) {
      return errorResponse('Status inválido. Use: running, paused, cancelled', 400);
    }

    const { data: current } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('id, status')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (!current) return errorResponse('Broadcast não encontrado', 404);
    if (current.status === 'completed' || current.status === 'cancelled') {
      return errorResponse(`Não é possível alterar um broadcast ${current.status}`, 400);
    }

    const updates: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    };

    if (body.status === 'running' && current.status === 'pending') {
      updates.started_at = new Date().toISOString();
    }

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .update(updates)
      .eq('id', jobId)
      .select('id, status, current_index, total_count')
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, `Broadcast ${body.status}`);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
