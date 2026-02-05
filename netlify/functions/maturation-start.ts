/**
 * Netlify Function: maturation-start
 * 
 * POST /.netlify/functions/maturation-start
 * 
 * Inicia um job de maturação manual
 * 
 * Body:
 * {
 *   plan_id: string (UUID),
 *   target_chat_id?: string (opcional, usa default do plano se não fornecido)
 * }
 * 
 * Headers:
 * - Authorization: Bearer <userId> ou X-User-Id: <userId>
 * 
 * Fluxo:
 * 1. Autentica usuário
 * 2. Valida plano
 * 3. Seleciona instância mestre livre (is_active=true, not locked)
 * 4. Locka instância mestre
 * 5. Cria job (status=running)
 * 6. Gera steps com scheduled_at baseado em delaySec
 * 7. Cria mensagem inicial no feed
 * 8. Retorna job_id
 */

import { createClient } from '@supabase/supabase-js';

interface HandlerEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
  requestId?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

// Cria cliente Supabase com service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

/** ID do plano "Mensagens do Auto maturador" (insert_auto_matador_plan.sql). Usado quando use_virgin_messages=true. */
const PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001';

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

/** Busca mensagens do Auto maturador (virgin_maturation_config) e retorna steps com delaySec entre cada. */
async function getVirginMessagesAsSteps(): Promise<Array<{ type: string; delaySec: number; payload: Record<string, unknown> }>> {
  const { data, error } = await supabaseServiceRole
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', 'messages')
    .maybeSingle();
  if (error || !data?.value_json) return [];
  const arr = Array.isArray(data.value_json) ? data.value_json : [];
  const messages = arr.map(normalizeVirginMessage).filter((x): x is VirginMessageItem => x != null);
  const delaySec = 10;
  return messages.map((msg, i) => {
    if (msg.type === 'text') {
      return { type: 'text' as const, delaySec, payload: { text: msg.text } };
    }
    const payload: Record<string, unknown> = { media_path: msg.media_path };
    if ('caption' in msg && msg.caption) payload.caption = msg.caption;
    return { type: msg.type, delaySec, payload };
  });
}

/**
 * Extrai userId do header Authorization ou X-User-Id
 */
function getUserIdFromHeaders(headers: Record<string, string>): string | null {
  // Tenta X-User-Id primeiro
  const userIdHeader = headers['x-user-id'] || headers['X-User-Id'];
  if (userIdHeader?.trim()) {
    return userIdHeader.trim();
  }
  
  // Tenta Authorization Bearer
  const authHeader = headers['authorization'] || headers['Authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  
  return null;
}

/**
 * Valida se usuário existe
 */
async function validateUser(userId: string): Promise<boolean> {
  const { data, error } = await supabaseServiceRole
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  
  return !error && !!data;
}

/**
 * Seleciona instância mestre livre.
 * Opcional: preferredEvolutionInstanceIds — usa apenas instâncias dessa lista.
 */
async function selectAvailableMasterInstance(preferredEvolutionInstanceIds?: string[]): Promise<{
  id: string;
  evolution_instance_id: string;
  instance_name: string;
} | null> {
  const preferList = preferredEvolutionInstanceIds?.length ? preferredEvolutionInstanceIds : undefined;

  let fromPoolQuery = supabaseServiceRole
    .from('master_instances')
    .select(`
      id,
      evolution_instance_id,
      evolution_instances!inner (
        instance_name
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
      instance_name: (instance as { instance_name: string }).instance_name,
    };
  }

  const { data: connectedMasters, error: evError } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name')
    .eq('is_active', true)
    .eq('is_master', true)
    .in('status', ['ok', 'open', 'connected'])
    .limit(50);

  if (evError || !connectedMasters?.length) {
    return null;
  }

  const candidates = preferList?.length
    ? connectedMasters.filter((ei: { id: string }) => preferList.includes(ei.id))
    : connectedMasters;

  const { data: poolRows } = await supabaseServiceRole
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
  if (!candidate) {
    return null;
  }

  const existing = inPoolByEvolutionId.get(candidate.id);
  if (existing) {
    return {
      id: existing.id,
      evolution_instance_id: candidate.id,
      instance_name: candidate.instance_name,
    };
  }

  const { data: inserted, error: insertError } = await supabaseServiceRole
    .from('master_instances')
    .insert({
      evolution_instance_id: candidate.id,
      is_active: true,
      is_locked: false,
    })
    .select('id, evolution_instance_id')
    .single();

  if (insertError || !inserted) {
    console.error('[maturation-start] Erro ao inserir master_instance:', insertError);
    return null;
  }

  return {
    id: inserted.id,
    evolution_instance_id: inserted.evolution_instance_id,
    instance_name: candidate.instance_name,
  };
}

/**
 * Locka instância mestre
 */
async function lockMasterInstance(masterInstanceId: string, jobId: string): Promise<boolean> {
  const { error } = await supabaseServiceRole
    .from('master_instances')
    .update({
      is_locked: true,
      locked_job_id: jobId,
      locked_at: new Date().toISOString(),
    })
    .eq('id', masterInstanceId)
    .eq('is_locked', false); // Só locka se ainda não estiver locked
  
  return !error;
}

/**
 * Cria mensagem no feed
 */
async function createMessage(params: {
  jobId: string;
  stepId?: string;
  direction: 'system' | 'instance';
  instanceLabel?: string;
  type: 'text' | 'video' | 'info' | 'error' | 'retry';
  title?: string;
  content?: string;
  mediaUrl?: string;
  status?: 'sent' | 'failed' | 'retrying' | 'info';
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
}): Promise<void> {
  await supabaseServiceRole
    .from('maturation_messages')
    .insert({
      job_id: params.jobId,
      step_id: params.stepId || null,
      direction: params.direction,
      instance_label: params.instanceLabel || null,
      type: params.type,
      title: params.title || null,
      content: params.content || null,
      media_url: params.mediaUrl || null,
      status: params.status || null,
      latency_ms: params.latencyMs || null,
      http_status: params.httpStatus || null,
      error: params.error || null,
    });
}

export const handler: Handler = async (event, context) => {
  console.log('[maturation-start] Iniciando...');
  
  // Verifica método HTTP
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Autentica usuário
  const userId = getUserIdFromHeaders(event.headers || {});
  if (!userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Não autenticado' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  const isValidUser = await validateUser(userId);
  if (!isValidUser) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Usuário inválido' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Parse body
  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Body inválido' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  const { plan_id, target_chat_id, use_virgin_messages, preferred_evolution_instance_ids, delay_seconds_override } = body;
  
  const useVirgin = use_virgin_messages === true;
  let planId: string;
  let steps: Array<{ type: string; delaySec: number; payload: Record<string, unknown>; target_chat_id?: string }> = [];
  
  if (useVirgin) {
    planId = PLAN_ID_VIRGIN_MESSAGES;
    steps = await getVirginMessagesAsSteps();
    if (steps.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Nenhuma mensagem configurada no Auto maturador. Configure em Admin > Maturador.' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
  } else {
    if (!plan_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'plan_id é obrigatório' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
    planId = plan_id;
  }
  
  // Busca plano (para validar existência e obter default_target_chat_id se não useVirgin)
  const { data: plan, error: planError } = await supabaseServiceRole
    .from('maturation_plans')
    .select('*')
    .eq('id', planId)
    .eq('is_active', true)
    .single();
  
  if (planError || !plan) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Plano não encontrado ou inativo' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  if (!useVirgin) {
    try {
      const planSteps = Array.isArray(plan.steps_json) ? plan.steps_json : [];
      if (planSteps.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Plano não possui steps configurados' }),
          headers: { 'Content-Type': 'application/json' },
        };
      }
      steps = planSteps as Array<{ type: string; delaySec: number; payload: Record<string, unknown>; target_chat_id?: string }>;
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'steps_json inválido' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
  }
  
  // Seleciona instância mestre livre (opcional: preferir lista de IDs)
  const masterInstance = await selectAvailableMasterInstance(
    Array.isArray(preferred_evolution_instance_ids) ? preferred_evolution_instance_ids : undefined
  );
  if (!masterInstance) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: preferred_evolution_instance_ids?.length
          ? 'Nenhuma das instâncias selecionadas está disponível no momento.'
          : 'Nenhuma instância mestre disponível no momento',
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Target Chat ID opcional: job pode ter target padrão; steps podem ter target_chat_id próprio (grupo no meio do fluxo)
  const finalTargetChatId = (typeof target_chat_id === 'string' && target_chat_id.trim()) || plan.default_target_chat_id || null;

  // Cria job (target_chat_id opcional)
  const { data: job, error: jobError } = await supabaseServiceRole
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
  
  if (jobError || !job) {
    console.error('[maturation-start] Erro ao criar job:', jobError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro ao criar job' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Locka instância mestre
  const locked = await lockMasterInstance(masterInstance.id, job.id);
  if (!locked) {
    // Rollback: deleta job
    await supabaseServiceRole.from('maturation_jobs').delete().eq('id', job.id);
    return {
      statusCode: 409,
      body: JSON.stringify({ error: 'Instância mestre foi lockada por outro processo' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Gera steps: primeiro step scheduled_at = now (processar na hora); demais com delay
  const delayOverride =
    typeof delay_seconds_override === 'number' && delay_seconds_override >= 0 ? delay_seconds_override : null;
  const baseTime = new Date();
  let cumulativeDelay = 0;
  
  const stepsToInsert = steps.map((step, index) => {
    const stepDelay = delayOverride ?? step.delaySec ?? 5;
    const scheduledAt = index === 0
      ? baseTime
      : new Date(baseTime.getTime() + cumulativeDelay * 1000);
    cumulativeDelay += stepDelay;
    const stepTargetChatId =
      typeof step.target_chat_id === 'string' && step.target_chat_id.trim()
        ? step.target_chat_id.trim()
        : null;
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
  
  const { error: stepsError } = await supabaseServiceRole
    .from('maturation_steps')
    .insert(stepsToInsert);
  
  if (stepsError) {
    console.error('[maturation-start] Erro ao criar steps:', stepsError);
    // Rollback: libera lock e deleta job
    await supabaseServiceRole
      .from('master_instances')
      .update({ is_locked: false, locked_job_id: null, locked_at: null })
      .eq('id', masterInstance.id);
    await supabaseServiceRole.from('maturation_jobs').delete().eq('id', job.id);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro ao criar steps' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  
  // Cria mensagem inicial
  await createMessage({
    jobId: job.id,
    direction: 'system',
    type: 'info',
    title: 'Job iniciado',
    content: `Job de maturação iniciado. Instância alocada: ${masterInstance.instance_name}. Total de steps: ${steps.length}`,
    status: 'info',
  });
  
  console.log(`[maturation-start] Job criado: ${job.id}`);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      job_id: job.id,
      master_instance: masterInstance.instance_name,
      total_steps: steps.length,
    }),
    headers: { 'Content-Type': 'application/json' },
  };
};

