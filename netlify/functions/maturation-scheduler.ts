/**
 * Netlify Scheduled Function: maturation-scheduler
 * 
 * Roda em intervalos configuráveis (ex: a cada 10 minutos ou 1x por dia)
 * 
 * Cria jobs automaticamente para instâncias mestre conforme regras configuradas
 * 
 * Regras (podem ser configuradas via tabela ou variáveis de ambiente):
 * - Rodar plano default para instâncias com health_score < X
 * - Rodar plano default para instâncias que não rodam há N horas
 * - Limite de jobs simultâneos por instância
 * 
 * Por enquanto, implementação básica que pode ser estendida conforme necessidade
 */

import { createClient } from '@supabase/supabase-js';
import { clampMaturationStepDelaySec } from '../../lib/maturation/min-step-delay';

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

// Configurações (podem vir de variáveis de ambiente ou tabela de config)
const MIN_HEALTH_SCORE = parseInt(process.env.MATURATION_MIN_HEALTH_SCORE || '80', 10);
const MAX_HOURS_SINCE_LAST_JOB = parseInt(process.env.MATURATION_MAX_HOURS_SINCE_LAST_JOB || '24', 10);
const DEFAULT_PLAN_ID = process.env.MATURATION_DEFAULT_PLAN_ID || null; // UUID do plano padrão

/**
 * Busca instâncias mestre que precisam de maturação
 */
async function findInstancesNeedingMaturation(): Promise<Array<{
  id: string;
  evolution_instance_id: string;
  instance_name: string;
  health_score: number;
  last_seen_at: string | null;
}>> {
  // Busca instâncias ativas, não lockadas, com health_score baixo ou sem jobs recentes
  const { data: instances, error } = await supabaseServiceRole
    .from('master_instances')
    .select(`
      id,
      evolution_instance_id,
      is_locked,
      health_score,
      last_seen_at,
      evolution_instances!inner (
        instance_name
      )
    `)
    .eq('is_active', true)
    .eq('is_locked', false);
  
  if (error || !instances) {
    console.error('[maturation-scheduler] Erro ao buscar instâncias:', error);
    return [];
  }
  
  const now = new Date();
  const maxHoursAgo = new Date(now.getTime() - MAX_HOURS_SINCE_LAST_JOB * 60 * 60 * 1000);
  
  // Filtra instâncias que precisam de maturação
  const needingMaturation = instances
    .map((inst: any) => {
      const instance = Array.isArray(inst.evolution_instances) 
        ? inst.evolution_instances[0] 
        : inst.evolution_instances;
      
      return {
        id: inst.id,
        evolution_instance_id: inst.evolution_instance_id,
        instance_name: instance.instance_name,
        health_score: inst.health_score,
        last_seen_at: inst.last_seen_at,
      };
    })
    .filter((inst) => {
      // Precisa de maturação se:
      // 1. Health score está baixo
      // 2. Não teve job recente (last_seen_at é null ou muito antigo)
      const needsByHealth = inst.health_score < MIN_HEALTH_SCORE;
      const needsByTime = !inst.last_seen_at || new Date(inst.last_seen_at) < maxHoursAgo;
      
      return needsByHealth || needsByTime;
    });
  
  return needingMaturation;
}

/**
 * Busca último job de uma instância mestre
 */
async function getLastJobForInstance(masterInstanceId: string): Promise<{
  ended_at: string | null;
} | null> {
  const { data, error } = await supabaseServiceRole
    .from('maturation_jobs')
    .select('ended_at')
    .eq('master_instance_id', masterInstanceId)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error || !data) {
    return null;
  }
  
  return data;
}

/**
 * Cria job de maturação para uma instância
 */
async function createMaturationJobForInstance(
  masterInstanceId: string,
  planId: string,
  targetChatId: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  // Busca plano
  const { data: plan, error: planError } = await supabaseServiceRole
    .from('maturation_plans')
    .select('*')
    .eq('id', planId)
    .eq('is_active', true)
    .single();
  
  if (planError || !plan) {
    return { success: false, error: 'Plano não encontrado ou inativo' };
  }
  
  // Valida steps
  let steps: Array<{ type: string; delaySec: number; payload: any }>;
  try {
    steps = Array.isArray(plan.steps_json) ? plan.steps_json : [];
    if (steps.length === 0) {
      return { success: false, error: 'Plano não possui steps configurados' };
    }
  } catch (error) {
    return { success: false, error: 'steps_json inválido' };
  }
  
  // Busca instância mestre para verificar se ainda está disponível
  const { data: masterInstance, error: masterError } = await supabaseServiceRole
    .from('master_instances')
    .select('*')
    .eq('id', masterInstanceId)
    .eq('is_active', true)
    .eq('is_locked', false)
    .single();
  
  if (masterError || !masterInstance) {
    return { success: false, error: 'Instância mestre não está disponível' };
  }
  
  // Busca owner_user_id do plano (ou usa um admin/system user)
  const ownerUserId = plan.created_by || null;
  if (!ownerUserId) {
    // Se não tem owner, busca primeiro admin
    const { data: admin } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('status', 'admin')
      .limit(1)
      .maybeSingle();
    
    if (!admin) {
      return { success: false, error: 'Nenhum usuário admin encontrado para criar job' };
    }
    
    // Usa admin como owner
    const { data: job, error: jobError } = await supabaseServiceRole
      .from('maturation_jobs')
      .insert({
        owner_user_id: admin.id,
        plan_id: planId,
        master_instance_id: masterInstanceId,
        target_chat_id: (targetChatId && targetChatId.trim()) || (plan.default_target_chat_id && plan.default_target_chat_id.trim()) || null,
        status: 'running',
        progress_total: steps.length,
        progress_done: 0,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (jobError || !job) {
      return { success: false, error: 'Erro ao criar job' };
    }
    
    // Locka instância
    await supabaseServiceRole
      .from('master_instances')
      .update({
        is_locked: true,
        locked_job_id: job.id,
        locked_at: new Date().toISOString(),
      })
      .eq('id', masterInstanceId);
    
    // Gera steps
    const baseTime = new Date();
    let cumulativeDelay = 0;
    
    const stepsToInsert = steps.map((step: { type: string; delaySec: number; payload: any; target_chat_id?: string }, index: number) => {
      cumulativeDelay += clampMaturationStepDelaySec(step.delaySec);
      const scheduledAt = new Date(baseTime.getTime() + cumulativeDelay * 1000);
      const stepTargetChatId = (typeof step.target_chat_id === 'string' && step.target_chat_id.trim()) ? step.target_chat_id.trim() : null;
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
    
    await supabaseServiceRole
      .from('maturation_steps')
      .insert(stepsToInsert);
    
    return { success: true, jobId: job.id };
  }
  
  // Se tem owner, usa ele
  const { data: job, error: jobError } = await supabaseServiceRole
    .from('maturation_jobs')
    .insert({
      owner_user_id: ownerUserId,
      plan_id: planId,
      master_instance_id: masterInstanceId,
      target_chat_id: (targetChatId && targetChatId.trim()) || (plan.default_target_chat_id && plan.default_target_chat_id.trim()) || null,
      status: 'running',
      progress_total: steps.length,
      progress_done: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (jobError || !job) {
    return { success: false, error: 'Erro ao criar job' };
  }
  
  // Locka instância
  await supabaseServiceRole
    .from('master_instances')
    .update({
      is_locked: true,
      locked_job_id: job.id,
      locked_at: new Date().toISOString(),
    })
    .eq('id', masterInstanceId);
  
  // Gera steps
  const baseTime = new Date();
  let cumulativeDelay = 0;
  
  const stepsToInsert = steps.map((step: { type: string; delaySec: number; payload: any; target_chat_id?: string }, index: number) => {
    cumulativeDelay += clampMaturationStepDelaySec(step.delaySec);
    const scheduledAt = new Date(baseTime.getTime() + cumulativeDelay * 1000);
    const stepTargetChatId = (typeof step.target_chat_id === 'string' && step.target_chat_id.trim()) ? step.target_chat_id.trim() : null;
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
  
  await supabaseServiceRole
    .from('maturation_steps')
    .insert(stepsToInsert);
  
  return { success: true, jobId: job.id };
}

export const handler: Handler = async (event, context) => {
  console.log('[maturation-scheduler] Iniciando agendamento...');
  
  try {
    // Verifica se há plano padrão configurado
    if (!DEFAULT_PLAN_ID) {
      console.log('[maturation-scheduler] Nenhum plano padrão configurado (MATURATION_DEFAULT_PLAN_ID)');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Nenhum plano padrão configurado', scheduled: 0 }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
    
    // Busca instâncias que precisam de maturação
    const instances = await findInstancesNeedingMaturation();
    
    if (instances.length === 0) {
      console.log('[maturation-scheduler] Nenhuma instância precisa de maturação no momento');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Nenhuma instância precisa de maturação', scheduled: 0 }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
    
    console.log(`[maturation-scheduler] ${instances.length} instâncias precisam de maturação`);
    
    // Busca plano padrão para obter target_chat_id
    const { data: defaultPlan } = await supabaseServiceRole
      .from('maturation_plans')
      .select('default_target_chat_id')
      .eq('id', DEFAULT_PLAN_ID)
      .single();
    
    const targetChatId = defaultPlan?.default_target_chat_id || null;
    if (!targetChatId) {
      console.warn('[maturation-scheduler] Plano padrão não possui default_target_chat_id configurado');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Plano padrão não possui target_chat_id', scheduled: 0 }),
        headers: { 'Content-Type': 'application/json' },
      };
    }
    
    // Cria jobs para cada instância
    const results = [];
    for (const instance of instances) {
      try {
        const result = await createMaturationJobForInstance(
          instance.id,
          DEFAULT_PLAN_ID,
          targetChatId
        );
        
        if (result.success) {
          console.log(`[maturation-scheduler] Job criado para instância ${instance.instance_name}: ${result.jobId}`);
          results.push({ instance: instance.instance_name, success: true, jobId: result.jobId });
        } else {
          console.warn(`[maturation-scheduler] Erro ao criar job para ${instance.instance_name}: ${result.error}`);
          results.push({ instance: instance.instance_name, success: false, error: result.error });
        }
      } catch (error: any) {
        console.error(`[maturation-scheduler] Erro ao processar instância ${instance.instance_name}:`, error);
        results.push({ instance: instance.instance_name, success: false, error: error.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    console.log(`[maturation-scheduler] Agendamento concluído: ${successCount}/${instances.length} jobs criados`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Agendamento concluído',
        scheduled: successCount,
        total: instances.length,
        results: results,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error: any) {
    console.error('[maturation-scheduler] Erro inesperado:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro inesperado', details: error.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

