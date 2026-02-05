/**
 * Lógica compartilhada para iniciar job de maturação.
 * Usado por: Netlify Function maturation-start e API Next.js POST /api/maturation/start (dev local).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001';

type VirginMessageItem =
  | { type: 'text'; text: string }
  | { type: 'video'; media_path: string; caption?: string }
  | { type: 'image'; media_path: string; caption?: string }
  | { type: 'audio'; media_path: string };

function normalizeVirginMessage(m: unknown): VirginMessageItem | null {
  if (typeof m === 'string') {
    const t = m.trim();
    return t ? { type: 'text', text: t } : null;
  }
  if (m && typeof m === 'object' && 'type' in m && typeof (m as Record<string, unknown>).type === 'string') {
    const o = m as Record<string, unknown>;
    const type = (o.type as string).toLowerCase();
    if (type === 'text') {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      return text ? { type: 'text', text } : null;
    }
    if (['video', 'image', 'audio'].includes(type)) {
      const media_path = typeof o.media_path === 'string' ? o.media_path.trim() : '';
      if (!media_path) return null;
      const caption = typeof o.caption === 'string' ? o.caption.trim() : undefined;
      if (type === 'audio') return { type: 'audio', media_path };
      return { type: type as 'video' | 'image', media_path, caption };
    }
  }
  return null;
}

async function getVirginMessagesAsSteps(supabase: SupabaseClient): Promise<Array<{ type: string; delaySec: number; payload: Record<string, unknown>; target_chat_id?: string | null }>> {
  const { data, error } = await supabase
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', 'messages')
    .maybeSingle();
  if (error || !data?.value_json) return [];
  const arr = Array.isArray(data.value_json) ? data.value_json : [];
  const messages = arr.map(normalizeVirginMessage).filter((x): x is VirginMessageItem => x != null);
  const delaySec = 10;
  return messages.map((msg) => {
    if (msg.type === 'text') {
      return { type: 'text' as const, delaySec, payload: { text: msg.text } };
    }
    const payload: Record<string, unknown> = { media_path: msg.media_path };
    if ('caption' in msg && msg.caption) payload.caption = msg.caption;
    return { type: msg.type, delaySec, payload };
  });
}

async function selectAvailableMasterInstance(
  supabase: SupabaseClient,
  preferredEvolutionInstanceIds?: string[]
): Promise<{
  id: string;
  evolution_instance_id: string;
  instance_name: string;
  phone_number: string | null;
} | null> {
  const preferList = preferredEvolutionInstanceIds?.length
    ? preferredEvolutionInstanceIds
    : undefined;

  let fromPoolQuery = supabase
    .from('master_instances')
    .select(`
      id,
      evolution_instance_id,
      evolution_instances!inner (
        instance_name,
        phone_number
      )
    `)
    .eq('is_active', true)
    .eq('is_locked', false);

  if (preferList?.length) {
    fromPoolQuery = fromPoolQuery.in('evolution_instance_id', preferList);
  }
  const { data: fromPool, error: poolError } = await fromPoolQuery.limit(1).maybeSingle();

  if (!poolError && fromPool) {
    const instance = Array.isArray(fromPool.evolution_instances)
      ? fromPool.evolution_instances[0]
      : fromPool.evolution_instances;
    return {
      id: fromPool.id,
      evolution_instance_id: fromPool.evolution_instance_id,
      instance_name: (instance as any).instance_name,
      phone_number: (instance as any).phone_number,
    };
  }

  const { data: connectedMasters, error: evError } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, phone_number')
    .eq('is_active', true)
    .eq('is_master', true)
    .in('status', ['ok', 'open', 'connected'])
    .limit(50);

  if (evError || !connectedMasters?.length) return null;

  let candidates = connectedMasters.filter(
    (ei: { id: string }) => !preferList || preferList.includes(ei.id)
  );

  const { data: poolRows } = await supabase
    .from('master_instances')
    .select('id, evolution_instance_id, is_locked')
    .eq('is_active', true);

  const lockedIds = new Set(
    (poolRows || []).filter((r: { is_locked: boolean }) => r.is_locked).map((r: { evolution_instance_id: string }) => r.evolution_instance_id)
  );
  const inPoolByEvolutionId = new Map(
    (poolRows || []).map((r: { id: string; evolution_instance_id: string }) => [r.evolution_instance_id, r])
  );

  const candidate = candidates.find((ei: { id: string }) => !lockedIds.has(ei.id));
  if (!candidate) return null;

  const existing = inPoolByEvolutionId.get(candidate.id);
  if (existing) {
    return {
      id: existing.id,
      evolution_instance_id: candidate.id,
      instance_name: candidate.instance_name,
      phone_number: (candidate as any).phone_number,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('master_instances')
    .insert({
      evolution_instance_id: candidate.id,
      is_active: true,
      is_locked: false,
    })
    .select('id, evolution_instance_id')
    .single();

  if (insertError || !inserted) return null;

  return {
    id: inserted.id,
    evolution_instance_id: inserted.evolution_instance_id,
    instance_name: candidate.instance_name,
    phone_number: (candidate as any).phone_number,
  };
}

async function lockMasterInstance(supabase: SupabaseClient, masterInstanceId: string, jobId: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_instances')
    .update({
      is_locked: true,
      locked_job_id: jobId,
      locked_at: new Date().toISOString(),
    })
    .eq('id', masterInstanceId)
    .eq('is_locked', false);
  return !error;
}

async function createMessage(supabase: SupabaseClient, params: {
  jobId: string;
  direction: 'system' | 'instance';
  type: 'text' | 'video' | 'info' | 'error' | 'retry';
  title?: string;
  content?: string;
  status?: 'sent' | 'failed' | 'retrying' | 'info';
}): Promise<void> {
  await supabase.from('maturation_messages').insert({
    job_id: params.jobId,
    step_id: null,
    direction: params.direction,
    instance_label: null,
    type: params.type,
    title: params.title ?? null,
    content: params.content ?? null,
    media_url: null,
    status: params.status ?? null,
    latency_ms: null,
    http_status: null,
    error: null,
  });
}

export type StartJobParams = {
  userId: string;
  body: {
    plan_id?: string;
    target_chat_id?: string;
    use_virgin_messages?: boolean;
    preferred_evolution_instance_ids?: string[];
    delay_seconds_override?: number;
  };
};

export type StartJobResult =
  | { success: true; job_id: string; job_ids: string[]; master_instance: string; master_instances: string[]; total_steps: number }
  | { success: false; error: string; statusCode: number };

export async function runMaturationStart(supabase: SupabaseClient, params: StartJobParams): Promise<StartJobResult> {
  const { userId, body } = params;
  const { plan_id, target_chat_id, use_virgin_messages, preferred_evolution_instance_ids, delay_seconds_override } = body;
  const useVirgin = use_virgin_messages === true;

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!profile) {
    return { success: false, error: 'Usuário inválido', statusCode: 401 };
  }

  let planId: string;
  let steps: Array<{ type: string; delaySec: number; payload: Record<string, unknown>; target_chat_id?: string | null }> = [];

  if (useVirgin) {
    planId = PLAN_ID_VIRGIN_MESSAGES;
    steps = await getVirginMessagesAsSteps(supabase);
    if (steps.length === 0) {
      return {
        success: false,
        error: 'Nenhuma mensagem configurada no Auto maturador. Configure em Admin > Maturador.',
        statusCode: 400,
      };
    }
  } else {
    if (!plan_id) {
      return { success: false, error: 'plan_id é obrigatório', statusCode: 400 };
    }
    planId = plan_id;
  }

  const { data: plan, error: planError } = await supabase
    .from('maturation_plans')
    .select('*')
    .eq('id', planId)
    .eq('is_active', true)
    .single();

  if (planError || !plan) {
    return { success: false, error: 'Plano não encontrado ou inativo', statusCode: 404 };
  }

  if (!useVirgin) {
    const planSteps = Array.isArray(plan.steps_json) ? plan.steps_json : [];
    if (planSteps.length === 0) {
      return { success: false, error: 'Plano não possui steps configurados', statusCode: 400 };
    }
    steps = planSteps as typeof steps;
  }

  const finalTargetChatId =
    (typeof target_chat_id === 'string' && target_chat_id.trim()) || plan.default_target_chat_id || null;

  const delayOverride =
    typeof delay_seconds_override === 'number' && delay_seconds_override >= 0 ? delay_seconds_override : null;

  const jobIds: string[] = [];
  const masterInstanceNames: string[] = [];

  const createOneJob = async (): Promise<{ jobId: string; instanceName: string } | null> => {
    const masterInstance = await selectAvailableMasterInstance(supabase, preferred_evolution_instance_ids);
    if (!masterInstance) return null;

    const { data: job, error: jobError } = await supabase
      .from('maturation_jobs')
      .insert({
        owner_user_id: userId,
        plan_id: planId,
        master_instance_id: masterInstance.id,
        target_chat_id: finalTargetChatId,
        status: 'running',
        progress_total: steps.length,
        progress_done: 0,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError || !job) return null;

    const locked = await lockMasterInstance(supabase, masterInstance.id, job.id);
    if (!locked) {
      await supabase.from('maturation_jobs').delete().eq('id', job.id);
      return null;
    }

    const baseTime = new Date();
    let cumulativeDelay = 0;
    const stepsToInsert = steps.map((step, index) => {
      const stepDelay = delayOverride ?? step.delaySec ?? 5;
      const scheduledAt = index === 0
        ? baseTime
        : new Date(baseTime.getTime() + cumulativeDelay * 1000);
      cumulativeDelay += stepDelay;
      const stepTargetChatId =
        typeof step.target_chat_id === 'string' && step.target_chat_id.trim() ? step.target_chat_id.trim() : null;
      return {
        job_id: job.id,
        step_index: index,
        type: step.type,
        payload_json: step.payload || {},
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
        target_chat_id: stepTargetChatId,
      };
    });

    const { error: stepsError } = await supabase.from('maturation_steps').insert(stepsToInsert);

    if (stepsError) {
      await supabase
        .from('master_instances')
        .update({ is_locked: false, locked_job_id: null, locked_at: null })
        .eq('id', masterInstance.id);
      await supabase.from('maturation_jobs').delete().eq('id', job.id);
      return null;
    }

    await createMessage(supabase, {
      jobId: job.id,
      direction: 'system',
      type: 'info',
      title: 'Job iniciado',
      content: `Job de maturação iniciado. Instância: ${masterInstance.instance_name}. Total de steps: ${steps.length}`,
      status: 'info',
    });

    return { jobId: job.id, instanceName: masterInstance.instance_name };
  };

  const multipleRequested = (preferred_evolution_instance_ids?.length ?? 0) > 1;
  const participatingInstances: Array<{ jobId: string; instanceName: string; phoneNumber: string | null; masterInstanceId: string }> = [];

  if (multipleRequested) {
    while (true) {
      const masterInstance = await selectAvailableMasterInstance(supabase, preferred_evolution_instance_ids);
      if (!masterInstance) break;

      const { data: job, error: jobError } = await supabase
        .from('maturation_jobs')
        .insert({
          owner_user_id: userId,
          plan_id: planId,
          master_instance_id: masterInstance.id,
          target_chat_id: 'pending_assignment', // Providório
          status: 'running',
          progress_total: steps.length,
          progress_done: 0,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jobError || !job) break;

      const locked = await lockMasterInstance(supabase, masterInstance.id, job.id);
      if (!locked) {
        await supabase.from('maturation_jobs').delete().eq('id', job.id);
        break;
      }

      participatingInstances.push({
        jobId: job.id,
        instanceName: masterInstance.instance_name,
        phoneNumber: masterInstance.phone_number,
        masterInstanceId: masterInstance.id
      });
    }

    if (participatingInstances.length === 0) {
      return {
        success: false,
        error: 'Nenhuma das instâncias selecionadas está disponível no momento.',
        statusCode: 503,
      };
    }

    // Agora atribui os alvos ciclicamente: A fala com B, B com C, ..., N com A
    for (let i = 0; i < participatingInstances.length; i++) {
      const current = participatingInstances[i];
      const nextIndex = (i + 1) % participatingInstances.length;
      const partner = participatingInstances[nextIndex];
      
      // Se houver apenas 1 (ex: só uma estava livre de fato), usa o original
      const target = participatingInstances.length > 1 
        ? (partner.phoneNumber || partner.instanceName) + '@s.whatsapp.net'
        : finalTargetChatId;

      await supabase.from('maturation_jobs').update({ target_chat_id: target }).eq('id', current.jobId);

      // Cria os steps para este job
      const baseTime = new Date();
      let cumulativeDelay = 0;
      const stepsToInsert = steps.map((step, index) => {
        const stepDelay = delayOverride ?? step.delaySec ?? 5;
        const scheduledAt = index === 0 ? baseTime : new Date(baseTime.getTime() + cumulativeDelay * 1000);
        cumulativeDelay += stepDelay;
        const stepTargetChatId = typeof step.target_chat_id === 'string' && step.target_chat_id.trim() ? step.target_chat_id.trim() : null;
        return {
          job_id: current.jobId,
          step_index: index,
          type: step.type,
          payload_json: step.payload || {},
          scheduled_at: scheduledAt.toISOString(),
          status: 'pending',
          target_chat_id: stepTargetChatId,
        };
      });

      await supabase.from('maturation_steps').insert(stepsToInsert);
      await createMessage(supabase, {
        jobId: current.jobId,
        direction: 'system',
        type: 'info',
        title: 'Job iniciado',
        content: `Job iniciado. Instância: ${current.instanceName}. Falando com: ${target}.`,
        status: 'info',
      });
    }

    return {
      success: true,
      job_id: participatingInstances[0].jobId,
      job_ids: participatingInstances.map(p => p.jobId),
      master_instance: participatingInstances[0].instanceName,
      master_instances: participatingInstances.map(p => p.instanceName),
      total_steps: steps.length,
    };
  }

  // Caso de única instância ou qualquer disponível
  const masterInstance = await selectAvailableMasterInstance(supabase, preferred_evolution_instance_ids);
  if (!masterInstance) {
    return { success: false, error: 'Nenhuma instância mestre disponível.', statusCode: 503 };
  }

  const { data: job, error: jobError } = await supabase
    .from('maturation_jobs')
    .insert({
      owner_user_id: userId,
      plan_id: planId,
      master_instance_id: masterInstance.id,
      target_chat_id: finalTargetChatId,
      status: 'running',
      progress_total: steps.length,
      progress_done: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (jobError || !job) return { success: false, error: 'Erro ao criar job', statusCode: 500 };

  const locked = await lockMasterInstance(supabase, masterInstance.id, job.id);
  if (!locked) {
    await supabase.from('maturation_jobs').delete().eq('id', job.id);
    return { success: false, error: 'Instância ocupada', statusCode: 409 };
  }

  // Cria os steps
  const baseTime = new Date();
  let cumulativeDelay = 0;
  const stepsToInsert = steps.map((step, index) => {
    const stepDelay = delayOverride ?? step.delaySec ?? 5;
    const scheduledAt = index === 0 ? baseTime : new Date(baseTime.getTime() + cumulativeDelay * 1000);
    cumulativeDelay += stepDelay;
    const stepTargetChatId = typeof step.target_chat_id === 'string' && step.target_chat_id.trim() ? step.target_chat_id.trim() : null;
    return {
      job_id: job.id,
      step_index: index,
      type: step.type,
      payload_json: step.payload || {},
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
      target_chat_id: stepTargetChatId,
    };
  });

  await supabase.from('maturation_steps').insert(stepsToInsert);
  await createMessage(supabase, {
    jobId: job.id,
    direction: 'system',
    type: 'info',
    title: 'Job iniciado',
    content: `Job iniciado. Instância: ${masterInstance.instance_name}.`,
    status: 'info',
  });

  return {
    success: true,
    job_id: job.id,
    job_ids: [job.id],
    master_instance: masterInstance.instance_name,
    master_instances: [masterInstance.instance_name],
    total_steps: steps.length,
  };
}
