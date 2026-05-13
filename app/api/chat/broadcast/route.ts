/**
 * /api/chat/broadcast
 *
 * GET  → lista broadcasts do usuário (últimos 20)
 * POST → cria um novo job de disparo em massa
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

export interface BroadcastContact {
  phone: string;
  name?: string;
}

export interface BroadcastMessageConfig {
  type: 'text' | 'audio' | 'video' | 'image' | 'document';
  content?: string;
  attachment_url?: string;
  mimetype?: string;
  caption?: string;
  fileName?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select(
        'id, title, instance_name, total_count, current_index, message_step_index, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds, broadcast_instances, status, started_at, completed_at, created_at, last_error, message_config'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return errorResponse(error.message, 500);
    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const { message_config: mc, ...rest } = row;
      return {
        ...rest,
        message_steps_count: parseBroadcastSteps(mc).length,
      };
    });
    return successResponse(rows);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json() as {
      instance_id?: string;
      /** Preferencial: uma ou mais instâncias (rotação por contato). Se omitido, usa instance_id. */
      instance_ids?: string[];
      title?: string;
      /** Legado: uma única mensagem. Preferir message_steps. */
      message_config?: BroadcastMessageConfig;
      /** Sequência de mensagens para o mesmo contato (texto, áudio, etc.). */
      message_steps?: BroadcastStepConfig[];
      /** Segundos entre cada mensagem da sequência no mesmo contato (1–7200). */
      sequence_delay_seconds?: number;
      contacts: BroadcastContact[];
      delay_seconds?: number;
      delay_mode?: 'fixed' | 'random';
      delay_min_seconds?: number;
      delay_max_seconds?: number;
    };

    const {
      instance_id: bodyInstanceId,
      instance_ids: bodyInstanceIds,
      title,
      message_config: legacyMessageConfig,
      message_steps: bodyMessageSteps,
      sequence_delay_seconds: rawSeqDelay,
      contacts,
      delay_seconds = 120,
      delay_mode: rawMode,
      delay_min_seconds: rawMin,
      delay_max_seconds: rawMax,
    } = body;

    const delayMode: 'fixed' | 'random' = rawMode === 'random' ? 'random' : 'fixed';

    let delaySecondsStored = Math.min(7200, Math.max(10, Math.floor(Number(delay_seconds) || 120)));
    let delayMin: number | null = null;
    let delayMax: number | null = null;

    if (delayMode === 'random') {
      let lo = Math.max(1, Math.min(7200, Math.floor(Number(rawMin) || 1)));
      let hi = Math.max(1, Math.min(7200, Math.floor(Number(rawMax) || 120)));
      if (lo > hi) [lo, hi] = [hi, lo];
      delayMin = lo;
      delayMax = hi;
      delaySecondsStored = hi;
    }

    let steps: BroadcastStepConfig[] = [];
    if (Array.isArray(bodyMessageSteps) && bodyMessageSteps.length > 0) {
      steps = bodyMessageSteps.filter((s) => s && typeof s.type === 'string');
    } else if (legacyMessageConfig?.type) {
      steps = [legacyMessageConfig as BroadcastStepConfig];
    }
    if (steps.length === 0) return errorResponse('Informe ao menos uma mensagem (message_steps ou message_config)', 400);

    const seqDelay = Math.min(7200, Math.max(1, Math.floor(Number(rawSeqDelay) || 15)));
    const message_config_stored = wrapMessageConfigForInsert(steps, seqDelay);

    if (!contacts || contacts.length === 0) return errorResponse('contacts não pode ser vazio', 400);

    const idsRaw = Array.isArray(bodyInstanceIds) && bodyInstanceIds.length > 0 ? bodyInstanceIds : bodyInstanceId ? [bodyInstanceId] : [];
    const uniqueIds = [...new Set(idsRaw.map((x) => String(x).trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return errorResponse('Informe ao menos uma instância (instance_ids ou instance_id)', 400);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'suporte';

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

    // Filtra contatos com telefone válido
    const validContacts = contacts.filter((c) => {
      const digits = String(c.phone || '').replace(/\D/g, '');
      return digits.length >= 8;
    });

    if (validContacts.length === 0) return errorResponse('Nenhum contato com telefone válido', 400);

    const insertRow: Record<string, unknown> = {
      user_id: userId,
      instance_id: primary.id,
      instance_name: primary.instance_name,
      broadcast_instances,
      title: title || `Disparo ${new Date().toLocaleString('pt-BR')}`,
      message_config: message_config_stored,
      message_step_index: 0,
      contacts: validContacts,
      total_count: validContacts.length,
      current_index: 0,
      delay_seconds: delaySecondsStored,
      delay_mode: delayMode,
      delay_min_seconds: delayMode === 'random' ? delayMin : null,
      delay_max_seconds: delayMode === 'random' ? delayMax : null,
      status: 'pending',
    };

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .insert(insertRow)
      .select(
        'id, title, instance_name, total_count, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds, broadcast_instances, status, created_at'
      )
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Disparo criado com sucesso');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
