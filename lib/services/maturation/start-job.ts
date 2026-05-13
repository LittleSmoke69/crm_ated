/**
 * Lógica compartilhada para iniciar job de maturação.
 * Usado por: POST /api/maturation/start, POST /api/maturation/jobs e (legado) Netlify Function maturation-start.
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { canUseAnyMaturationPlan } from '@/lib/maturation/plan-access';
import { clampMaturationStepDelaySec, MATURATION_MIN_STEP_DELAY_SEC } from '@/lib/maturation/min-step-delay';
import { reconcileOrphanedMasterInstanceLocks } from '@/lib/maturation/reconcile-master-instance-locks';
import { getDefaultMutualMaturationPlanId } from '@/lib/maturation/default-mutual-plan';
import { evolutionMaturationDbStatusIsConnected } from '@/lib/utils/evolution-instance-status';
import {
  applyEvolutionInstancesVisibilityFilters,
  type EvolutionMaturationVisibilityScope,
  resolveEvolutionMaturationVisibilityScope,
} from '@/lib/server/evolution-maturation-visibility';

import { parseVirginMessagePlansFromConfig, type VirginMessageItem } from '@/lib/maturation/virgin-message-plans';

export const PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001';

async function getVirginMessagesAsSteps(
  supabase: SupabaseClient,
  planIndex = 0
): Promise<Array<{ type: string; delaySec: number; payload: Record<string, unknown>; target_chat_id?: string | null }>> {
  const { data, error } = await supabase
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', 'messages')
    .maybeSingle();
  if (error || !data?.value_json) return [];
  const plans = parseVirginMessagePlansFromConfig(data.value_json);
  if (plans.length === 0) return [];
  const idx = ((planIndex % plans.length) + plans.length) % plans.length;
  const messages = plans[idx];
  const delaySec = MATURATION_MIN_STEP_DELAY_SEC;
  return messages.map((msg: VirginMessageItem) => {
    if (msg.type === 'text') {
      return { type: 'text' as const, delaySec, payload: { text: msg.text } };
    }
    const payload: Record<string, unknown> = { media_path: msg.media_path };
    if ('caption' in msg && msg.caption) payload.caption = msg.caption;
    return { type: msg.type, delaySec, payload };
  });
}

/** IDs de evolution_instances visíveis ao usuário (escopo Instâncias) e liberadas para o maturador. */
async function evolutionIdsAllowedForMaturation(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
  scope: EvolutionMaturationVisibilityScope | null
): Promise<string[]> {
  if (!ids.length) return [];
  let q = supabase.from('evolution_instances').select('id').in('id', ids).eq('blocked_from_maturation', false);
  if (scope) {
    q = applyEvolutionInstancesVisibilityFilters(q, scope);
  } else {
    q = q.eq('user_id', userId);
  }
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => r.id);
}

/**
 * Garante linha em master_instances para a evolution_instance (pool do maturador).
 * Usado na malha mútua: a instância pode participar de vários jobs ao mesmo tempo
 * (não há trava exclusiva em master_instances para uma única campanha).
 */
async function ensureMasterInstanceForEvolution(
  supabase: SupabaseClient,
  userId: string,
  evolutionInstanceId: string,
  scope: EvolutionMaturationVisibilityScope | null
): Promise<{
  id: string;
  evolution_instance_id: string;
  instance_name: string;
  phone_number: string | null;
} | null> {
  let evoQ = supabase
    .from('evolution_instances')
    .select('id, instance_name, phone_number, blocked_from_maturation, is_active, user_id')
    .eq('id', evolutionInstanceId)
    .eq('is_active', true);
  if (scope) {
    evoQ = applyEvolutionInstancesVisibilityFilters(evoQ, scope);
  } else {
    evoQ = evoQ.eq('user_id', userId);
  }
  const { data: ev, error: evErr } = await evoQ.maybeSingle();
  if (evErr || !ev || ev.blocked_from_maturation === true) return null;

  const phone = ev.phone_number != null ? String(ev.phone_number).trim() : '';
  if (!phone) return null;

  const { data: existing } = await supabase
    .from('master_instances')
    .select('id')
    .eq('evolution_instance_id', evolutionInstanceId)
    .eq('is_active', true)
    .maybeSingle();

  if (existing?.id) {
    return {
      id: existing.id,
      evolution_instance_id: evolutionInstanceId,
      instance_name: String(ev.instance_name ?? ''),
      phone_number: ev.phone_number,
    };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('master_instances')
    .insert({
      evolution_instance_id: evolutionInstanceId,
      is_active: true,
      is_locked: false,
    })
    .select('id')
    .single();

  if (insErr || !inserted) return null;

  return {
    id: inserted.id,
    evolution_instance_id: evolutionInstanceId,
    instance_name: String(ev.instance_name ?? ''),
    phone_number: ev.phone_number,
  };
}

async function selectAvailableMasterInstance(
  supabase: SupabaseClient,
  userId: string,
  preferredEvolutionInstanceIds: string[] | undefined,
  scope: EvolutionMaturationVisibilityScope | null
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
        blocked_from_maturation,
        user_id
      )
    `)
    .eq('is_active', true);

  if (!scope?.bypassUserIdFilter) {
    if (scope && scope.allowedUserIds.length > 0) {
      fromPoolQuery = fromPoolQuery.in('evolution_instances.user_id', scope.allowedUserIds);
    } else {
      fromPoolQuery = fromPoolQuery.eq('evolution_instances.user_id', userId);
    }
  }

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

  let evoFallback = supabase
    .from('evolution_instances')
    .select('id, instance_name, phone_number, status')
    .eq('is_active', true)
    .eq('blocked_from_maturation', false)
    .not('phone_number', 'is', null)
    .limit(200);
  if (scope) {
    evoFallback = applyEvolutionInstancesVisibilityFilters(evoFallback, scope);
  } else {
    evoFallback = evoFallback.eq('user_id', userId);
  }
  const { data: connectedMastersRaw, error: evError } = await evoFallback;

  if (evError || !connectedMastersRaw?.length) return null;

  const connectedMasters = connectedMastersRaw.filter((row: { status?: string | null }) =>
    evolutionMaturationDbStatusIsConnected(row.status ?? null)
  );
  if (!connectedMasters.length) return null;

  let candidates = connectedMasters.filter(
    (ei: { id: string; phone_number?: string | null }) =>
      (!preferList || preferList.includes(ei.id)) &&
      !!(ei.phone_number && String(ei.phone_number).trim())
  );

  const { data: poolRows } = await supabase
    .from('master_instances')
    .select('id, evolution_instance_id')
    .eq('is_active', true);

  const inPoolByEvolutionId = new Map(
    (poolRows || []).map((r: { id: string; evolution_instance_id: string }) => [r.evolution_instance_id, r])
  );

  const candidate = candidates[0];
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

async function lockMasterInstance(_supabase: SupabaseClient, _masterInstanceId: string, _jobId: string): Promise<boolean> {
  /** Trava exclusiva removida: vários jobs de maturação podem usar o mesmo master_instance. */
  return true;
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

/** Normaliza número ou JID para envio (maturador multi-destino). */
function normalizeOutboundMaturationTarget(raw: string): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (t.includes('@')) {
    return t;
  }
  const digits = t.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${digits}@s.whatsapp.net`;
}

/** Lista até 5 destinos únicos a partir de array ou string com quebras de linha / vírgula. */
function normalizeOutboundTargetList(input: unknown): string[] {
  if (input == null) return [];
  const parts: string[] = Array.isArray(input)
    ? (input as unknown[]).flatMap((x) => String(x ?? '').split(/[\r\n,;]+/))
    : String(input).split(/[\r\n,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const jid = normalizeOutboundMaturationTarget(p);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    out.push(jid);
    if (out.length >= 5) break;
  }
  return out;
}

export type StartJobParams = {
  userId: string;
  /** Quando presente, validação de instâncias segue o mesmo escopo de GET /api/instances (super_admin, admin, hierarquia). */
  visibilityRequest?: NextRequest;
  body: {
    plan_id?: string;
    target_chat_id?: string;
    use_virgin_messages?: boolean;
    preferred_evolution_instance_ids?: string[];
    /** Até 5 JIDs/números: cria um job por destino na mesma instância (envios em paralelo no processador). */
    outbound_target_chat_ids?: string[];
    /** Quando true, usa o plano UUID em virgin_maturation_config (default_mutual_maturation_plan_id); libera uso para não-admins. */
    use_tenant_default_mutual_plan?: boolean;
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
      const stepDelay = clampMaturationStepDelaySec(step.delaySec);
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

// ─── Mesh campaign start ─────────────────────────────────────────────────────
const MESH_DEFAULT_INTERVAL_SEC = 30;
const MESH_MIN_INTERVAL_SEC = 5;
const MESH_MAX_INTERVAL_SEC = 3600;
const MESH_INITIAL_FIRE_MIN_TARGETS = 1;
const MESH_INITIAL_FIRE_MAX_TARGETS = 5;

export type StartMeshParams = {
  userId: string;
  visibilityRequest?: NextRequest;
  body: {
    /** evolution_instance_ids participantes (≥2). Inclui virgens e maturadas. */
    participant_evolution_instance_ids: string[];
    /** Intervalo entre ciclos (segundos). Padrão 30. Aceita 5-3600. */
    cycle_interval_sec?: number;
    /** Nome opcional da campanha (display). */
    name?: string;
  };
};

export type StartMeshResult =
  | {
      success: true;
      campaign_id: string;
      controller_job_id: string;
      job_ids: string[];
      participants: Array<{ master_instance_id: string; instance_name: string; phone_number: string }>;
      cycle_interval_sec: number;
    }
  | { success: false; error: string; statusCode: number };

/**
 * Adiciona instâncias `ids` (que ainda não participam) à campanha `existingController`.
 * Não cria controller novo, não dispara fire inicial. Reutilizado:
 *  (a) quando o existence check no topo do `runMeshStart` encontra uma mesh ativa, e
 *  (b) quando a criação do controller falha por unique violation (race entre Starts simultâneos).
 */
async function joinExistingMesh(
  supabase: SupabaseClient,
  userId: string,
  visibilityScope: EvolutionMaturationVisibilityScope | null,
  ids: string[],
  existingController: {
    id: string;
    campaign_id: string;
    mesh_cycle_interval_sec: number | null;
    status: string;
  }
): Promise<StartMeshResult> {
  const { data: planRow } = await supabase
    .from('maturation_plans')
    .select('id, is_active')
    .eq('id', PLAN_ID_VIRGIN_MESSAGES)
    .maybeSingle();
  if (planRow && planRow.is_active !== true) {
    await supabase
      .from('maturation_plans')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', PLAN_ID_VIRGIN_MESSAGES);
  }

  const { data: existingJobs } = await supabase
    .from('maturation_jobs')
    .select('id, master_instance_id, master_instances!inner(evolution_instance_id)')
    .eq('campaign_id', existingController.campaign_id);

  const existingEvoIds = new Set<string>();
  for (const j of (existingJobs || []) as any[]) {
    const mi = Array.isArray(j.master_instances) ? j.master_instances[0] : j.master_instances;
    if (mi?.evolution_instance_id) existingEvoIds.add(String(mi.evolution_instance_id));
  }

  const newEvoIds = ids.filter((id) => !existingEvoIds.has(id));
  const addedParticipants: Array<{
    master_instance_id: string;
    instance_name: string;
    phone_number: string;
  }> = [];

  if (newEvoIds.length > 0) {
    const now = new Date();
    for (const evoId of newEvoIds) {
      const mi = await ensureMasterInstanceForEvolution(supabase, userId, evoId, visibilityScope);
      if (!mi) continue;

      const { data: addedJob, error: addErr } = await supabase
        .from('maturation_jobs')
        .insert({
          owner_user_id: userId,
          plan_id: PLAN_ID_VIRGIN_MESSAGES,
          master_instance_id: mi.id,
          target_chat_id: '',
          campaign_id: existingController.campaign_id,
          status: existingController.status,
          progress_total: 0,
          progress_done: 0,
          started_at: now.toISOString(),
          mesh_is_controller: false,
        })
        .select('id')
        .single();

      if (!addErr && addedJob) {
        addedParticipants.push({
          master_instance_id: mi.id,
          instance_name: mi.instance_name,
          phone_number: String(mi.phone_number || '').trim(),
        });
      }
    }
  }

  if (addedParticipants.length > 0) {
    await createMessage(supabase, {
      jobId: existingController.id,
      direction: 'system',
      type: 'info',
      title: 'Instâncias entraram na rede',
      content: `${addedParticipants.length} nova(s) instância(s) adicionada(s) à campanha em andamento: ${addedParticipants
        .map((p) => p.instance_name)
        .join(', ')}.`,
      status: 'info',
    });
    console.log(
      `[MATURATION-MESH] JOIN campaign=${existingController.campaign_id}: +${addedParticipants.length} instância(s)`
    );
  } else {
    console.log(
      `[MATURATION-MESH] JOIN campaign=${existingController.campaign_id}: nada a adicionar (todas já participam)`
    );
  }

  const { data: allJobs } = await supabase
    .from('maturation_jobs')
    .select(
      'id, master_instance_id, master_instances!inner(evolution_instances!inner(instance_name, phone_number))'
    )
    .eq('campaign_id', existingController.campaign_id);

  const allParticipants = ((allJobs || []) as any[]).map((j) => {
    const mi = Array.isArray(j.master_instances) ? j.master_instances[0] : j.master_instances;
    const ei = mi
      ? Array.isArray(mi.evolution_instances)
        ? mi.evolution_instances[0]
        : mi.evolution_instances
      : null;
    return {
      master_instance_id: j.master_instance_id,
      instance_name: String(ei?.instance_name ?? ''),
      phone_number: String(ei?.phone_number ?? ''),
    };
  });

  return {
    success: true,
    campaign_id: existingController.campaign_id,
    controller_job_id: existingController.id,
    job_ids: ((allJobs || []) as any[]).map((j) => j.id),
    participants: allParticipants,
    cycle_interval_sec:
      existingController.mesh_cycle_interval_sec || MESH_DEFAULT_INTERVAL_SEC,
  };
}

export async function runMeshStart(
  supabase: SupabaseClient,
  params: StartMeshParams
): Promise<StartMeshResult> {
  const { userId, visibilityRequest, body } = params;
  let ids = Array.from(new Set((body.participant_evolution_instance_ids || []).filter(Boolean)));

  const intervalSec = (() => {
    const n = Number(body.cycle_interval_sec);
    if (!Number.isFinite(n)) return MESH_DEFAULT_INTERVAL_SEC;
    return Math.max(MESH_MIN_INTERVAL_SEC, Math.min(MESH_MAX_INTERVAL_SEC, Math.round(n)));
  })();

  await reconcileOrphanedMasterInstanceLocks(supabase);

  const visibilityScope: EvolutionMaturationVisibilityScope | null =
    visibilityRequest != null
      ? await resolveEvolutionMaturationVisibilityScope(supabase, visibilityRequest, userId)
      : null;

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!profile) return { success: false, error: 'Usuário inválido', statusCode: 401 };

  // Auto-discover: lista vazia = toda a rede elegível (conectada, com telefone, liberada).
  // Ordenação: instâncias DO usuário primeiro (assim o disparo inicial sai do telefone DELE).
  if (ids.length === 0) {
    let q = supabase
      .from('evolution_instances')
      .select('id, phone_number, status, user_id')
      .eq('is_active', true)
      .eq('blocked_from_maturation', false)
      .not('phone_number', 'is', null);
    if (visibilityScope) {
      q = applyEvolutionInstancesVisibilityFilters(q, visibilityScope);
    } else {
      q = q.eq('user_id', userId);
    }
    const { data: rows, error: discErr } = await q;
    if (discErr) {
      return { success: false, error: `Erro ao descobrir instâncias: ${discErr.message}`, statusCode: 500 };
    }
    const filtered = (rows || []).filter(
      (r: any) =>
        r.id &&
        r.phone_number &&
        String(r.phone_number).trim() &&
        evolutionMaturationDbStatusIsConnected(r.status)
    );
    const own = filtered.filter((r: any) => String(r.user_id) === String(userId));
    const others = filtered.filter((r: any) => String(r.user_id) !== String(userId));
    ids = [...own.map((r: any) => r.id as string), ...others.map((r: any) => r.id as string)];
  }

  // Identifica quais ids pertencem ao usuário (pra usar no disparo inicial como remetentes)
  const userOwnedEvoIds = new Set<string>();
  if (ids.length > 0) {
    const { data: ownerRows } = await supabase
      .from('evolution_instances')
      .select('id, user_id')
      .in('id', ids);
    for (const r of (ownerRows || []) as any[]) {
      if (String(r.user_id) === String(userId)) userOwnedEvoIds.add(String(r.id));
    }
  }

  // ─── JOIN em campanha existente (singleton global) ───────────────────────
  // Existe NO MÁXIMO uma mesh rodando/pausada no sistema inteiro (não por usuário).
  // Se já existe, NÃO criamos campanha paralela: adicionamos os ids novos como participantes
  // do mesmo campaign_id. Sem novo controller, sem novo disparo inicial.
  const { data: existingController } = await supabase
    .from('maturation_jobs')
    .select('id, campaign_id, mesh_cycle_interval_sec, status, owner_user_id')
    .eq('mesh_is_controller', true)
    .in('status', ['running', 'paused'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingController && existingController.campaign_id) {
    return await joinExistingMesh(supabase, userId, visibilityScope, ids, {
      id: existingController.id,
      campaign_id: existingController.campaign_id,
      mesh_cycle_interval_sec: existingController.mesh_cycle_interval_sec,
      status: existingController.status,
    });
  }

  if (ids.length < 2) {
    return {
      success: false,
      error: 'Menos de 2 instâncias conectadas com telefone na rede. Conecte mais instâncias.',
      statusCode: 400,
    };
  }

  // Garante que o plano virgem (usado por TODOS os jobs do mesh) existe e está ativo.
  // Se estiver inativo, o sweep failRunningMaturationJobsWithInactivePlans mata todos os jobs no
  // primeiro tick. Se não existir, o INSERT abaixo falha por FK. Reativamos / criamos defensivamente.
  {
    const { data: existingPlan } = await supabase
      .from('maturation_plans')
      .select('id, is_active')
      .eq('id', PLAN_ID_VIRGIN_MESSAGES)
      .maybeSingle();

    if (!existingPlan) {
      const { error: createErr } = await supabase.from('maturation_plans').insert({
        id: PLAN_ID_VIRGIN_MESSAGES,
        name: 'Mensagens do Auto maturador',
        description:
          'Plano usado pelo Maturador Mesh. Steps gerados em runtime a partir de virgin_maturation_config.',
        is_active: true,
        steps_json: [],
      });
      if (createErr) {
        return {
          success: false,
          error: `Plano virgem do mesh não existe e falha ao criar: ${createErr.message}`,
          statusCode: 500,
        };
      }
      console.warn(
        `[MATURATION-MESH] Plano virgem ${PLAN_ID_VIRGIN_MESSAGES} não existia — criado automaticamente.`
      );
    } else if (existingPlan.is_active !== true) {
      const { error: actErr } = await supabase
        .from('maturation_plans')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', PLAN_ID_VIRGIN_MESSAGES);
      if (actErr) {
        return {
          success: false,
          error: `Plano virgem do mesh está inativo e falha ao reativar: ${actErr.message}`,
          statusCode: 500,
        };
      }
      console.warn(
        `[MATURATION-MESH] Plano virgem ${PLAN_ID_VIRGIN_MESSAGES} estava inativo — reativado automaticamente.`
      );
    }
  }

  // Garante master_instances pra todas as evolution_instances selecionadas
  const participants: Array<{
    masterInstanceId: string;
    evolutionInstanceId: string;
    instanceName: string;
    phoneNumber: string;
  }> = [];

  for (const evoId of ids) {
    const mi = await ensureMasterInstanceForEvolution(supabase, userId, evoId, visibilityScope);
    if (!mi) {
      return {
        success: false,
        error: `Instância ${evoId} não disponível (sem telefone, bloqueada ou fora do escopo).`,
        statusCode: 400,
      };
    }
    participants.push({
      masterInstanceId: mi.id,
      evolutionInstanceId: mi.evolution_instance_id,
      instanceName: mi.instance_name,
      phoneNumber: String(mi.phone_number || '').trim(),
    });
  }

  if (participants.length < 2) {
    return { success: false, error: 'Menos de 2 instâncias válidas após filtro.', statusCode: 400 };
  }

  const campaignId = randomUUID();
  const planId = PLAN_ID_VIRGIN_MESSAGES;
  const now = new Date();

  // Cria 1 job por participante (compartilham campaign_id). O primeiro vira controller.
  const createdJobIds: string[] = [];
  let controllerJobId: string | null = null;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const isController = i === 0;
    const insertPayload: Record<string, unknown> = {
      owner_user_id: userId,
      plan_id: planId,
      master_instance_id: p.masterInstanceId,
      target_chat_id: '', // não usado em mesh; cada step tem seu próprio target_chat_id
      campaign_id: campaignId,
      status: 'running',
      progress_total: 0,
      progress_done: 0,
      started_at: now.toISOString(),
      mesh_is_controller: isController,
    };
    if (isController) {
      // Disparo inicial é IMEDIATO; primeiro ciclo do loop começa após interval.
      insertPayload.mesh_cycle_interval_sec = intervalSec;
      insertPayload.mesh_cycle_count = 0;
      insertPayload.mesh_next_cycle_at = new Date(now.getTime() + intervalSec * 1000).toISOString();
      insertPayload.mesh_last_sender_master_ids = [];
    }

    const { data: job, error: jobErr } = await supabase
      .from('maturation_jobs')
      .insert(insertPayload)
      .select('id')
      .single();

    if (jobErr || !job) {
      // RACE: outro Start ganhou a corrida e criou o controller entre nossa checagem e este INSERT.
      // Postgres bloqueia via partial unique index (idx_maturation_jobs_mesh_singleton_controller).
      // Fallback: rollback do que criamos e JOIN no controller vencedor.
      if (isController && (jobErr as any)?.code === '23505') {
        if (createdJobIds.length > 0) {
          await supabase.from('maturation_jobs').delete().in('id', createdJobIds);
        }
        const { data: winner } = await supabase
          .from('maturation_jobs')
          .select('id, campaign_id, mesh_cycle_interval_sec, status')
          .eq('mesh_is_controller', true)
          .in('status', ['running', 'paused'])
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (winner?.campaign_id) {
          console.warn(
            `[MATURATION-MESH] Race detectada na criação do controller; fazendo JOIN em campaign=${winner.campaign_id}`
          );
          return await joinExistingMesh(supabase, userId, visibilityScope, ids, {
            id: winner.id,
            campaign_id: winner.campaign_id,
            mesh_cycle_interval_sec: winner.mesh_cycle_interval_sec,
            status: winner.status,
          });
        }
        // Sem vencedor visível mas violation rolou — caso patológico, retorna erro
        return {
          success: false,
          error: 'Conflito ao criar controller mesh sem vencedor visível. Tente novamente.',
          statusCode: 409,
        };
      }

      // Erro não relacionado a race: rollback e erro
      if (createdJobIds.length > 0) {
        await supabase.from('maturation_jobs').delete().in('id', createdJobIds);
      }
      return {
        success: false,
        error: `Erro ao criar job mesh: ${jobErr?.message || 'desconhecido'}`,
        statusCode: 500,
      };
    }
    createdJobIds.push(job.id);
    if (isController) controllerJobId = job.id;
  }

  if (!controllerJobId) {
    return { success: false, error: 'Falha interna ao definir controller', statusCode: 500 };
  }

  // ─── Disparo inicial ─────────────────────────────────────────────────────
  // Cada instância DO USUÁRIO dispara uma mensagem para 1-5 destinatários sorteados.
  // Assim o usuário vê na hora, no próprio WhatsApp, mensagens saindo dos telefones dele —
  // sinal visual de que o maturador iniciou. Se não houver instâncias do usuário na rede
  // (ex.: super-admin sem instâncias próprias), faz fallback pra primeira instância da rede.
  const userOwnedSenders = participants.map((p, idx) => ({ p, idx, jobId: createdJobIds[idx] }))
    .filter((x) => userOwnedEvoIds.has(x.p.evolutionInstanceId));

  const initialSendersForFire = userOwnedSenders.length > 0
    ? userOwnedSenders.slice(0, MESH_INITIAL_FIRE_MAX_TARGETS) // limita pra não inundar
    : [{ p: participants[0], idx: 0, jobId: createdJobIds[0] }];

  const initialPool = await getVirginMessagesAsSteps(supabase);
  const initialFireSummary: Array<{ from: string; to: string[] }> = [];

  if (initialPool.length > 0) {
    for (const sender of initialSendersForFire) {
      const senderPart = sender.p;
      const others = participants.filter((p) => p.masterInstanceId !== senderPart.masterInstanceId);
      if (others.length === 0) continue;

      const targetCount = Math.max(
        MESH_INITIAL_FIRE_MIN_TARGETS,
        Math.min(
          MESH_INITIAL_FIRE_MAX_TARGETS,
          others.length,
          MESH_INITIAL_FIRE_MIN_TARGETS + Math.floor(Math.random() * MESH_INITIAL_FIRE_MAX_TARGETS)
        )
      );
      const shuffledTargets = [...others].sort(() => Math.random() - 0.5).slice(0, targetCount);

      const initialStepsToInsert = shuffledTargets.map((target, idx) => {
        const msg = initialPool[Math.floor(Math.random() * initialPool.length)];
        const phone = String(target.phoneNumber || '').trim();
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        return {
          job_id: sender.jobId,
          step_index: idx,
          type: msg.type,
          payload_json: msg.payload || {},
          scheduled_at: now.toISOString(),
          status: 'pending',
          target_chat_id: jid,
          sender_master_instance_id: senderPart.masterInstanceId,
        };
      });

      const { error: stepErr } = await supabase.from('maturation_steps').insert(initialStepsToInsert);
      if (!stepErr) {
        await supabase
          .from('maturation_jobs')
          .update({ progress_total: initialStepsToInsert.length })
          .eq('id', sender.jobId);
        initialFireSummary.push({
          from: senderPart.instanceName,
          to: shuffledTargets.map((t) => t.instanceName),
        });
      } else {
        console.warn(
          `[MATURATION-MESH] Erro disparo inicial sender=${senderPart.instanceName}: ${stepErr.message}`
        );
      }
    }
  }

  const summaryText = initialFireSummary.length > 0
    ? initialFireSummary
        .map((s) => `${s.from} → ${s.to.join(', ')}`)
        .join(' | ')
    : '(pool de mensagens vazio ou sem alvos)';

  // Marca os senders do disparo inicial em mesh_last_sender_master_ids do controller —
  // assim a UI mostra "Último envio: <suas instâncias>" mesmo antes do primeiro ciclo do loop.
  // Também conta o disparo inicial como "ciclo #1" (mesh_cycle_count=1).
  const initialSenderMasterIds = initialSendersForFire
    .filter((s) => initialFireSummary.some((sum) => sum.from === s.p.instanceName))
    .map((s) => s.p.masterInstanceId);

  if (initialSenderMasterIds.length > 0) {
    await supabase
      .from('maturation_jobs')
      .update({
        mesh_last_sender_master_ids: initialSenderMasterIds,
        mesh_cycle_count: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', controllerJobId);
  }

  await createMessage(supabase, {
    jobId: controllerJobId,
    direction: 'system',
    type: 'info',
    title: 'Mesh iniciado',
    content: `Campanha ${campaignId.slice(0, 8)}… ${participants.length} instâncias, intervalo ${intervalSec}s. Disparo inicial: ${summaryText}`,
    status: 'info',
  });

  console.log(
    `[MATURATION-MESH] Campanha ${campaignId} criada: ${participants.length} participantes, intervalo ${intervalSec}s, controller=${controllerJobId}`
  );

  return {
    success: true,
    campaign_id: campaignId,
    controller_job_id: controllerJobId,
    job_ids: createdJobIds,
    participants: participants.map((p) => ({
      master_instance_id: p.masterInstanceId,
      instance_name: p.instanceName,
      phone_number: p.phoneNumber,
    })),
    cycle_interval_sec: intervalSec,
  };
}

export async function runMaturationStart(supabase: SupabaseClient, params: StartJobParams): Promise<StartJobResult> {
  const { userId, body, visibilityRequest } = params;
  const {
    plan_id,
    target_chat_id,
    use_virgin_messages,
    preferred_evolution_instance_ids,
    use_tenant_default_mutual_plan,
    outbound_target_chat_ids,
  } = body;
  const useVirgin = use_virgin_messages === true;

  await reconcileOrphanedMasterInstanceLocks(supabase);

  const visibilityScope: EvolutionMaturationVisibilityScope | null =
    visibilityRequest != null
      ? await resolveEvolutionMaturationVisibilityScope(supabase, visibilityRequest, userId)
      : null;

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
  let usingTenantDefaultMutualPlan = false;

  if (use_tenant_default_mutual_plan === true) {
    const tenantPlanId = await getDefaultMutualMaturationPlanId(supabase);
    if (!tenantPlanId) {
      return {
        success: false,
        error: 'Nenhum plano de rede mútua configurado pelo administrador. Peça ao admin para definir em Admin > Maturador.',
        statusCode: 400,
      };
    }
    planId = tenantPlanId;
    usingTenantDefaultMutualPlan = true;
  } else if (useVirgin) {
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

  if (
    !useVirgin &&
    !usingTenantDefaultMutualPlan &&
    plan.created_by !== userId &&
    !canUseAnyMaturationPlan(profile.status)
  ) {
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
      delaySec: clampMaturationStepDelaySec(s.delaySec ?? s.delay_seconds),
      payload: (s.payload as Record<string, unknown>) || {},
      target_chat_id:
        typeof s.target_chat_id === 'string' && s.target_chat_id.trim() ? s.target_chat_id.trim() : null,
    }));
  }

  const finalTargetChatId =
    (typeof target_chat_id === 'string' && target_chat_id.trim()) || plan.default_target_chat_id || null;

  const preferredList = preferred_evolution_instance_ids ?? [];
  const preferredFiltered =
    preferredList.length > 0 ? await evolutionIdsAllowedForMaturation(supabase, userId, preferredList, visibilityScope) : [];

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
      const stepDelay = clampMaturationStepDelaySec(step.delaySec);
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

  const outboundTargets = !useVirgin ? normalizeOutboundTargetList(outbound_target_chat_ids) : [];

  if (!useVirgin && outboundTargets.length > 0) {
    let senderEvoId: string | null = null;
    if (preferredForSelect?.length) {
      const { data: preRows } = await supabase
        .from('evolution_instances')
        .select('id, user_id')
        .in('id', preferredForSelect);
      const bypass = visibilityScope?.bypassUserIdFilter === true;
      const owned = (preRows || []).filter(
        (r: { id: string; user_id?: string | null }) => bypass || String(r.user_id) === String(userId)
      );
      const pool = owned.length > 0 ? owned : preRows || [];
      senderEvoId = pool[0]?.id ?? null;
    }
    if (!senderEvoId) {
      const pick = await selectAvailableMasterInstance(supabase, userId, undefined, visibilityScope);
      if (!pick) {
        return { success: false, error: 'Nenhuma instância disponível para enviar o plano.', statusCode: 503 };
      }
      senderEvoId = pick.evolution_instance_id;
    }

    const allowedSenders = await evolutionIdsAllowedForMaturation(supabase, userId, [senderEvoId], visibilityScope);
    if (allowedSenders.length === 0) {
      return {
        success: false,
        error: 'A instância remetente não está disponível no maturador para você.',
        statusCode: 403,
      };
    }

    const masterInstance = await ensureMasterInstanceForEvolution(supabase, userId, senderEvoId, visibilityScope);
    if (!masterInstance) {
      return {
        success: false,
        error: 'Instância remetente sem telefone ou bloqueada para maturação.',
        statusCode: 400,
      };
    }

    const createdIds: string[] = [];
    const startedAt = new Date().toISOString();
    try {
      for (let i = 0; i < outboundTargets.length; i++) {
        const jid = outboundTargets[i];
        const { data: job, error: jobError } = await supabase
          .from('maturation_jobs')
          .insert({
            owner_user_id: userId,
            plan_id: planId,
            master_instance_id: masterInstance.id,
            target_chat_id: jid,
            status: 'running',
            progress_total: steps.length,
            progress_done: 0,
            started_at: startedAt,
          })
          .select()
          .single();
        if (jobError || !job) throw new Error(jobError?.message || 'Erro ao criar job');
        if (i === 0) {
          await lockMasterInstance(supabase, masterInstance.id, job.id);
        }
        const stepsToInsert = buildStepsToInsert(job.id);
        const { error: insErr } = await supabase.from('maturation_steps').insert(stepsToInsert);
        if (insErr) throw new Error(insErr.message);
        await createMessage(supabase, {
          jobId: job.id,
          direction: 'system',
          type: 'info',
          title: 'Job iniciado',
          content: `Destino: ${jid}. Instância: ${masterInstance.instance_name}.`,
          status: 'info',
        });
        createdIds.push(job.id);
      }
      const totalStepsAll = steps.length * createdIds.length;
      return {
        success: true,
        job_id: createdIds[0],
        job_ids: createdIds,
        master_instance: masterInstance.instance_name,
        master_instances: [masterInstance.instance_name],
        total_steps: totalStepsAll,
      };
    } catch (e: unknown) {
      for (const delJobId of createdIds) {
        await supabase.from('maturation_steps').delete().eq('job_id', delJobId);
        await supabase.from('maturation_jobs').delete().eq('id', delJobId);
      }
      await supabase
        .from('master_instances')
        .update({ is_locked: false, locked_job_id: null, locked_at: null })
        .eq('id', masterInstance.id);
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg || 'Erro ao criar jobs paralelos', statusCode: 500 };
    }
  }

  if (multipleRequested) {
    const participatingInstances: Array<{
      jobId: string;
      instanceName: string;
      phoneNumber: string;
      masterInstanceId: string;
    }> = [];

    async function rollbackParticipatingMesh(): Promise<void> {
      for (const p of participatingInstances) {
        await supabase
          .from('master_instances')
          .update({ is_locked: false, locked_job_id: null, locked_at: null })
          .eq('id', p.masterInstanceId);
        await supabase.from('maturation_jobs').delete().eq('id', p.jobId);
      }
      participatingInstances.length = 0;
    }

    const orderedIds =
      preferredForSelect && preferredForSelect.length > 0
        ? preferredForSelect
        : null;

    if (orderedIds) {
      for (const evoId of orderedIds) {
        const masterInstance = await ensureMasterInstanceForEvolution(supabase, userId, evoId, visibilityScope);
        if (!masterInstance) {
          await rollbackParticipatingMesh();
          return {
            success: false,
            error:
              'Uma das instâncias selecionadas não tem telefone configurado, está bloqueada no maturador ou não existe. Ajuste em Instâncias.',
            statusCode: 400,
          };
        }

        const { data: job, error: jobError } = await supabase
          .from('maturation_jobs')
          .insert({
            owner_user_id: userId,
            plan_id: planId,
            master_instance_id: masterInstance.id,
            target_chat_id: null,
            status: 'running',
            progress_total: steps.length,
            progress_done: 0,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (jobError || !job) {
          await rollbackParticipatingMesh();
          return { success: false, error: 'Erro ao criar job de maturação', statusCode: 500 };
        }

        await lockMasterInstance(supabase, masterInstance.id, job.id);

        participatingInstances.push({
          jobId: job.id,
          instanceName: masterInstance.instance_name,
          phoneNumber: masterInstance.phone_number!,
          masterInstanceId: masterInstance.id,
        });
      }
    } else {
      while (true) {
        const masterInstance = await selectAvailableMasterInstance(supabase, userId, preferredForSelect, visibilityScope);
        if (!masterInstance) break;

        const { data: job, error: jobError } = await supabase
          .from('maturation_jobs')
          .insert({
            owner_user_id: userId,
            plan_id: planId,
            master_instance_id: masterInstance.id,
            target_chat_id: null,
            status: 'running',
            progress_total: steps.length,
            progress_done: 0,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (jobError || !job) break;

        await lockMasterInstance(supabase, masterInstance.id, job.id);

        participatingInstances.push({
          jobId: job.id,
          instanceName: masterInstance.instance_name,
          phoneNumber: masterInstance.phone_number!,
          masterInstanceId: masterInstance.id,
        });
      }
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
      delaySec: clampMaturationStepDelaySec(s.delaySec),
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
  const masterInstance = await selectAvailableMasterInstance(supabase, userId, preferredForSelect, visibilityScope);
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

  await lockMasterInstance(supabase, masterInstance.id, job.id);

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
