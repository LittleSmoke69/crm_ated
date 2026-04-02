/**
 * Lógica compartilhada para iniciar job de maturação.
 * Usado por: Netlify Function maturation-start e API Next.js POST /api/maturation/start (dev local).
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canUseAnyMaturationPlan } from '@/lib/maturation/plan-access';

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

/** IDs de evolution_instances que existem e não estão bloqueadas para o maturador. */
async function evolutionIdsAllowedForMaturation(supabase: SupabaseClient, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('evolution_instances')
    .select('id')
    .in('id', ids)
    .eq('blocked_from_maturation', false);
  if (error || !data) return [];
  return data.map((r) => r.id);
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
        phone_number,
        blocked_from_maturation
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
    const blocked = (instance as { blocked_from_maturation?: boolean })?.blocked_from_maturation === true;
    const phoneNumber = (instance as { phone_number?: string | null; instance_name?: string })?.phone_number;
    if (!blocked && phoneNumber && String(phoneNumber).trim()) {
      return {
        id: fromPool.id,
        evolution_instance_id: fromPool.evolution_instance_id,
        instance_name: String((instance as { instance_name?: string }).instance_name ?? ''),
        phone_number: phoneNumber,
      };
    }
  }

  const { data: connectedMasters, error: evError } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, phone_number')
    .eq('is_active', true)
    .eq('blocked_from_maturation', false)
    .in('status', ['ok', 'open', 'connected'])
    .not('phone_number', 'is', null)
    .limit(50);

  if (evError || !connectedMasters?.length) return null;

  let candidates = connectedMasters.filter(
    (ei: { id: string; phone_number?: string | null }) =>
      (!preferList || preferList.includes(ei.id)) &&
      !!(ei.phone_number && String(ei.phone_number).trim())
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
    /** @deprecated Ignorado: intervalos vêm sempre do plano (delaySec por step) ou das mensagens do Auto maturador. */
    delay_seconds_override?: number;
  };
};

export type StartJobResult =
  | {
      success: true;
      job_id: string;
      job_ids: string[];
      master_instance: string;
      master_instances: string[];
      total_steps: number;
      /** Presente quando 2+ instâncias: uma campanha (malha) com vários jobs, um por remetente */
      campaign_id?: string;
    }
  | { success: false; error: string; statusCode: number };

type PlanStepRow = {
  type: string;
  delaySec: number;
  payload: Record<string, unknown>;
  target_chat_id?: string | null;
};

/** Plano completo para cada destinatário; delays cumulativos entre todas as mensagens do job. */
function buildMeshStepsToInsert(
  jobId: string,
  planSteps: PlanStepRow[],
  recipientPhones: string[],
  baseTime: Date
): Array<{
  job_id: string;
  step_index: number;
  type: string;
  payload_json: Record<string, unknown>;
  scheduled_at: string;
  status: string;
  target_chat_id: string | null;
}> {
  const rows: Array<{
    job_id: string;
    step_index: number;
    type: string;
    payload_json: Record<string, unknown>;
    scheduled_at: string;
    status: string;
    target_chat_id: string | null;
  }> = [];
  let cumulativeDelay = 0;
  let stepIndex = 0;

  for (const rawPhone of recipientPhones) {
    const phone = String(rawPhone || '').trim();
    if (!phone) continue;
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    for (const step of planSteps) {
      const stepDelay = step.delaySec ?? 5;
      cumulativeDelay += stepDelay;
      const scheduledAt = new Date(baseTime.getTime() + cumulativeDelay * 1000);
      const explicit = typeof step.target_chat_id === 'string' && step.target_chat_id.trim();
      rows.push({
        job_id: jobId,
        step_index: stepIndex++,
        type: step.type,
        payload_json: step.payload || {},
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
        target_chat_id: explicit ? explicit.trim() : jid,
      });
    }
  }
  return rows;
}

export async function runMaturationStart(supabase: SupabaseClient, params: StartJobParams): Promise<StartJobResult> {
  const { userId, body } = params;
  const { plan_id, target_chat_id, use_virgin_messages, preferred_evolution_instance_ids } = body;
  const useVirgin = use_virgin_messages === true;

  console.log(`[MATURATION] Iniciando job: ${useVirgin ? 'Auto maturador (mensagens virgem)' : 'Maturador manual (plano)'} plan_id=${useVirgin ? 'virgem' : plan_id || ''} user=${userId}`);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status')
    .eq('id', userId)
    .maybeSingle();
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

  if (!useVirgin && plan.created_by !== userId && !canUseAnyMaturationPlan(profile.status)) {
    return {
      success: false,
      error: 'Você só pode iniciar jobs com planos criados por você. Use uma sugestão do admin como base e salve sua cópia.',
      statusCode: 403,
    };
  }

  if (!useVirgin) {
    const planSteps = Array.isArray(plan.steps_json) ? plan.steps_json : [];
    if (planSteps.length === 0) {
      return { success: false, error: 'Plano não possui steps configurados', statusCode: 400 };
    }
    steps = planSteps.map((s: Record<string, unknown>) => ({
      type: String(s.type || 'text'),
      delaySec: Math.max(1, Number(s.delaySec ?? s.delay_seconds ?? 5) || 5),
      payload: (s.payload as Record<string, unknown>) || {},
      target_chat_id:
        typeof s.target_chat_id === 'string' && s.target_chat_id.trim() ? s.target_chat_id.trim() : null,
    }));
  }

  const finalTargetChatId =
    (typeof target_chat_id === 'string' && target_chat_id.trim()) || plan.default_target_chat_id || null;

  const preferredList = preferred_evolution_instance_ids ?? [];
  const preferredFiltered =
    preferredList.length > 0 ? await evolutionIdsAllowedForMaturation(supabase, preferredList) : [];

  if (preferredList.length > 0 && preferredFiltered.length === 0) {
    return {
      success: false,
      error:
        'As instâncias selecionadas não estão disponíveis no maturador (bloqueadas ou inexistentes). Ajuste em Instâncias ou escolha outras.',
      statusCode: 400,
    };
  }

  const preferredForSelect = preferredFiltered.length > 0 ? preferredFiltered : undefined;

  const multipleRequested = preferredList.length > 1;

  /** Constrói os steps com delay cumulativo: cada step usa o intervalo configurado no plano (delaySec). */
  function buildStepsToInsert(jobId: string) {
    const baseTime = new Date();
    let cumulativeDelay = 0;
    return steps.map((step, index) => {
      const stepDelay = step.delaySec ?? 5;
      cumulativeDelay += stepDelay;
      const scheduledAt = new Date(baseTime.getTime() + cumulativeDelay * 1000);
      // Per-step target tem prioridade; se não tiver, usa o override passado (target do job)
      const stepTargetChatId =
        typeof step.target_chat_id === 'string' && step.target_chat_id.trim()
          ? step.target_chat_id.trim()
          : null;
      return {
        job_id: jobId,
        step_index: index,
        type: step.type,
        payload_json: step.payload || {},
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
        target_chat_id: stepTargetChatId,
      };
    });
  }

  if (multipleRequested) {
    // Coleta todas as instâncias disponíveis e já as bloqueia
    const participatingInstances: Array<{
      jobId: string;
      instanceName: string;
      phoneNumber: string;
      masterInstanceId: string;
    }> = [];

    while (true) {
      const masterInstance = await selectAvailableMasterInstance(supabase, preferredForSelect);
      if (!masterInstance) break;

      const { data: job, error: jobError } = await supabase
        .from('maturation_jobs')
        .insert({
          owner_user_id: userId,
          plan_id: planId,
          master_instance_id: masterInstance.id,
          target_chat_id: null, // será atribuído após montar o anel
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
        phoneNumber: masterInstance.phone_number!,
        masterInstanceId: masterInstance.id,
      });
    }

    if (participatingInstances.length === 0) {
      return {
        success: false,
        error: 'Nenhuma das instâncias selecionadas está disponível no momento.',
        statusCode: 503,
      };
    }

    // Com apenas 1 instância disponível e sem target definido, não há com quem conversar
    if (participatingInstances.length === 1 && !finalTargetChatId) {
      const orphan = participatingInstances[0];
      await supabase.from('master_instances')
        .update({ is_locked: false, locked_job_id: null, locked_at: null })
        .eq('id', orphan.masterInstanceId);
      await supabase.from('maturation_jobs').delete().eq('id', orphan.jobId);
      return {
        success: false,
        error: 'Apenas 1 instância disponível e nenhum destino configurado. Selecione ao menos 2 instâncias ou defina um destino.',
        statusCode: 422,
      };
    }

    /** Só 1 instância no pool mas usuário pediu multi → usa target externo (sem campanha). */
    if (participatingInstances.length === 1) {
      const one = participatingInstances[0];
      await supabase
        .from('maturation_jobs')
        .update({
          target_chat_id: finalTargetChatId!,
          progress_total: steps.length,
        })
        .eq('id', one.jobId);
      const stepsToInsert = buildStepsToInsert(one.jobId);
      const { error: insErr } = await supabase.from('maturation_steps').insert(stepsToInsert);
      if (insErr) {
        await supabase.from('master_instances')
          .update({ is_locked: false, locked_job_id: null, locked_at: null })
          .eq('id', one.masterInstanceId);
        await supabase.from('maturation_jobs').delete().eq('id', one.jobId);
        return { success: false, error: `Erro ao criar steps: ${insErr.message}`, statusCode: 500 };
      }
      await createMessage(supabase, {
        jobId: one.jobId,
        direction: 'system',
        type: 'info',
        title: 'Job iniciado',
        content: `Job iniciado. Instância: ${one.instanceName}. Destino: ${finalTargetChatId}.`,
        status: 'info',
      });
      return {
        success: true,
        job_id: one.jobId,
        job_ids: [one.jobId],
        master_instance: one.instanceName,
        master_instances: [one.instanceName],
        total_steps: steps.length,
      };
    }

    /**
     * Campanha única (campaign_id): malha completa.
     * Cada instância é remetente de um job; envia o plano inteiro a cada uma das outras (N-1 destinos).
     */
    const campaignId = randomUUID();
    const n = participatingInstances.length;
    const perSenderStepCount = (n - 1) * steps.length;
    const meshBaseTime = new Date();
    const planRows: PlanStepRow[] = steps.map((s) => ({
      type: s.type,
      delaySec: s.delaySec ?? 5,
      payload: s.payload || {},
      target_chat_id: s.target_chat_id,
    }));

    for (let i = 0; i < participatingInstances.length; i++) {
      const current = participatingInstances[i];
      const recipientPhones = participatingInstances
        .filter((_, j) => j !== i)
        .map((p) => String(p.phoneNumber || '').trim())
        .filter(Boolean);

      const firstJid = recipientPhones[0].includes('@')
        ? recipientPhones[0]
        : `${recipientPhones[0]}@s.whatsapp.net`;

      await supabase
        .from('maturation_jobs')
        .update({
          target_chat_id: firstJid,
          progress_total: perSenderStepCount,
          campaign_id: campaignId,
        })
        .eq('id', current.jobId);

      const stepsToInsert = buildMeshStepsToInsert(current.jobId, planRows, recipientPhones, meshBaseTime);

      const { error: insErr } = await supabase.from('maturation_steps').insert(stepsToInsert);
      if (insErr) {
        console.error(`[MATURATION] Erro ao inserir steps malha job=${current.jobId}:`, insErr.message);
        await supabase.from('master_instances')
          .update({ is_locked: false, locked_job_id: null, locked_at: null })
          .eq('id', current.masterInstanceId);
        await supabase.from('maturation_jobs').delete().eq('id', current.jobId);
        return { success: false, error: `Erro ao criar steps da campanha: ${insErr.message}`, statusCode: 500 };
      }

      const destLabel = recipientPhones.join(', ');
      await createMessage(supabase, {
        jobId: current.jobId,
        direction: 'system',
        type: 'info',
        title: 'Campanha malha — remetente',
        content: `Campanha ${campaignId.slice(0, 8)}… Remetente: ${current.instanceName}. Plano completo para: ${destLabel}.`,
        status: 'info',
      });
    }

    const totalStepsAllJobs = participatingInstances.length * perSenderStepCount;
    console.log(
      `[MATURATION] Campanha ${campaignId}: ${participatingInstances.length} job(s) remetente, ${perSenderStepCount} steps/job, malha completa`
    );
    return {
      success: true,
      campaign_id: campaignId,
      job_id: participatingInstances[0].jobId,
      job_ids: participatingInstances.map((p) => p.jobId),
      master_instance: participatingInstances[0].instanceName,
      master_instances: participatingInstances.map((p) => p.instanceName),
      total_steps: totalStepsAllJobs,
    };
  }

  // Caso de instância única
  const masterInstance = await selectAvailableMasterInstance(supabase, preferredForSelect);
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

  const stepsToInsert = buildStepsToInsert(job.id);
  const { error: stepsError } = await supabase.from('maturation_steps').insert(stepsToInsert);
  if (stepsError) {
    await supabase.from('master_instances')
      .update({ is_locked: false, locked_job_id: null, locked_at: null })
      .eq('id', masterInstance.id);
    await supabase.from('maturation_jobs').delete().eq('id', job.id);
    return { success: false, error: `Erro ao criar steps: ${stepsError.message}`, statusCode: 500 };
  }

  await createMessage(supabase, {
    jobId: job.id,
    direction: 'system',
    type: 'info',
    title: 'Job iniciado',
    content: `Job iniciado. Instância: ${masterInstance.instance_name}.`,
    status: 'info',
  });

  console.log(`[MATURATION] Job criado: job_id=${job.id} instance=${masterInstance.instance_name} steps=${steps.length}`);
  return {
    success: true,
    job_id: job.id,
    job_ids: [job.id],
    master_instance: masterInstance.instance_name,
    master_instances: [masterInstance.instance_name],
    total_steps: steps.length,
  };
}
