/**
 * Verificação WhatsApp na Limpeza de Lista: um único fluxo na API (sem Netlify/cron).
 * Intervalo fixo entre cada número; checagem de parada entre passos (stop define status ≠ verifying).
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  checkWhatsAppForListCleaning,
  checkWhatsAppForListCleaningEvolution,
} from '@/lib/services/whatsapp-check-service';
import { getEvolutionCredentialsForListCleaningJob } from '@/lib/server/list-cleaning-evolution-instance';
import { markEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';

/** Intervalo entre uma verificação e a próxima (ms). */
export const VERIFY_INTERVAL_MS = 1000;

/** Fragmento ao verificar parada durante o intervalo (ms). */
const STOP_POLL_STEP_MS = 250;

const SLOT_LOG_PREFIX = '[list-cleaning-slot]';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aguarda `totalMs` checando a cada STOP_POLL_STEP_MS se o job ainda está em verificação.
 * Retorna false se deve parar (usuário clicou em parar).
 */
async function sleepBetweenNumbersUnlessStopped(jobId: string, totalMs: number): Promise<boolean> {
  let left = totalMs;
  while (left > 0) {
    const { data: jobSnap } = await supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('status')
      .eq('id', jobId)
      .single();
    if (!jobSnap || jobSnap.status !== 'verifying') return false;
    const chunk = Math.min(STOP_POLL_STEP_MS, left);
    await sleep(chunk);
    left -= chunk;
  }
  return true;
}

export interface RunVerificationLoopResult {
  /** Parou porque o job deixou de estar em `verifying` (ex.: usuário parou). */
  stopped: boolean;
  /** Todos os pendentes foram processados nesta execução. */
  runCompleted: boolean;
  /** Quantidade de números verificados nesta requisição. */
  processedSession: number;
  /** Evolution retornou sessão encerrada — instância marcada disconnected e job em paused_disconnected. */
  evolutionSessionDropped?: boolean;
}

/** Opções passadas pelo POST verify (evita depender só de SELECT após UPDATE / réplica). */
export interface RunListCleaningVerificationOptions {
  verificationEvolutionInstanceId?: string;
}

async function refreshJobCounts(jobId: string): Promise<void> {
  const { count: verifiedCount } = await supabaseServiceRole
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .not('verified_at', 'is', null);

  const { count: activeCount } = await supabaseServiceRole
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .eq('whatsapp_status', 'active');

  const { count: notActiveCount } = await supabaseServiceRole
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .in('whatsapp_status', ['inactive', 'unknown']);

  const { data: job } = await supabaseServiceRole
    .from('list_cleaning_jobs')
    .select('total_unique')
    .eq('id', jobId)
    .single();

  const totalUnique = (job?.total_unique ?? 0) as number;
  const verified = verifiedCount ?? 0;
  const pending = Math.max(0, totalUnique - verified);

  await supabaseServiceRole
    .from('list_cleaning_jobs')
    .update({
      verified_count: verified,
      validated_count: activeCount ?? 0,
      not_validated_count: notActiveCount ?? 0,
      pending_count: pending,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function finalizeRunAndJob(jobId: string, runId: string): Promise<void> {
  await refreshJobCounts(jobId);
  await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', runId);
  await supabaseServiceRole
    .from('list_cleaning_jobs')
    .update({
      status: 'done',
      pending_count: 0,
      next_run_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

/**
 * Processa todos os números pendentes em sequência (1s entre cada), até terminar ou o job sair de `verifying`.
 */
export async function runListCleaningVerificationUntilStoppedOrDone(
  jobId: string,
  options?: RunListCleaningVerificationOptions
): Promise<RunVerificationLoopResult> {
  const { data: jobMeta } = await supabaseServiceRole
    .from('list_cleaning_jobs')
    .select('verification_evolution_instance_id')
    .eq('id', jobId)
    .single();

  const evolutionInstanceId =
    (options?.verificationEvolutionInstanceId?.trim() || undefined) ??
    (jobMeta?.verification_evolution_instance_id as string | undefined);
  const evolutionCtx = evolutionInstanceId
    ? await getEvolutionCredentialsForListCleaningJob(evolutionInstanceId)
    : null;

  const wasenderKey = process.env.WASENDER_API_KEY || '';
  const useEvolution = Boolean(evolutionCtx);
  const legacyWasenderOnly = !evolutionInstanceId && Boolean(wasenderKey);

  if (!useEvolution && !legacyWasenderOnly) {
    throw new Error('Credenciais de verificação indisponíveis (Evolution ou Wasender legado).');
  }

  let { data: runRow } = await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .select('id, processed_numbers, current_slot, total_numbers')
    .eq('job_id', jobId)
    .eq('status', 'running')
    .maybeSingle();

  /** Se o job passou por ensureRunForJob mas o run não está como running (ex.: pending legado). */
  if (!runRow) {
    await ensureRunForJob(jobId);
    ({ data: runRow } = await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .select('id, processed_numbers, current_slot, total_numbers')
      .eq('job_id', jobId)
      .eq('status', 'running')
      .maybeSingle());
  }

  if (!runRow) {
    console.error(
      `${SLOT_LOG_PREFIX} sem run running para job=${jobId} — verifique list_cleaning_verification_runs`
    );
    return { stopped: false, runCompleted: false, processedSession: 0 };
  }

  let processedNumbers = runRow.processed_numbers ?? 0;
  let currentSlot = runRow.current_slot ?? 0;
  let processedSession = 0;

  while (true) {
    const { data: jobSnap } = await supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (!jobSnap || jobSnap.status !== 'verifying') {
      await refreshJobCounts(jobId);
      return { stopped: true, runCompleted: false, processedSession };
    }

    const { data: pendingItems, error: pendingError } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id, phone')
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .is('verified_at', null)
      .order('created_at', { ascending: true })
      .limit(1);

    if (pendingError || !pendingItems?.length) {
      await finalizeRunAndJob(jobId, runRow.id);
      return { stopped: false, runCompleted: true, processedSession };
    }

    const item = pendingItems[0];

    try {
      let result: {
        status: 'active' | 'inactive' | 'unknown';
        raw: Record<string, unknown>;
      };

      if (useEvolution && evolutionCtx) {
        const ev = await checkWhatsAppForListCleaningEvolution(
          evolutionCtx.instance_name,
          evolutionCtx.base_url,
          evolutionCtx.api_key_global,
          item.phone
        );
        result = {
          status: ev.status,
          raw: ev.raw as unknown as Record<string, unknown>,
        };
      } else if (evolutionInstanceId && !evolutionCtx) {
        result = {
          status: 'unknown',
          raw: {
            source: 'evolution_whatsapp_numbers',
            error: 'instancia_indisponivel',
            phone: item.phone.replace(/\D/g, '').slice(0, 15),
            checked_at: new Date().toISOString(),
            exists_defined: false,
          },
        };
      } else {
        const ws = await checkWhatsAppForListCleaning(item.phone);
        result = {
          status: ws.status,
          raw: ws.raw as unknown as Record<string, unknown>,
        };
      }

      await supabaseServiceRole
        .from('list_cleaning_items')
        .update({
          whatsapp_status: result.status,
          verified_at: new Date().toISOString(),
          raw_payload: result.raw as unknown as Record<string, unknown>,
        })
        .eq('id', item.id);

      const evolutionSessionDropped =
        useEvolution &&
        evolutionCtx &&
        Boolean(evolutionInstanceId) &&
        (result.raw as { session_dropped?: boolean }).session_dropped === true;

      if (evolutionSessionDropped && evolutionInstanceId) {
        await markEvolutionInstanceDisconnected(
          supabaseServiceRole,
          evolutionInstanceId,
          'list-cleaning/whatsappNumbers'
        );
        await supabaseServiceRole
          .from('list_cleaning_jobs')
          .update({
            status: 'paused_disconnected',
            error_message:
              'A instância WhatsApp desconectou durante a verificação. Reconecte em Instâncias WhatsApp.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        processedNumbers += 1;
        currentSlot += 1;
        processedSession += 1;

        await supabaseServiceRole
          .from('list_cleaning_verification_runs')
          .update({
            status: 'error',
            error_message: 'Evolution: sessão encerrada (Connection Closed)',
            processed_numbers: processedNumbers,
            current_slot: currentSlot,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runRow.id);

        await refreshJobCounts(jobId);
        return {
          stopped: true,
          runCompleted: false,
          processedSession,
          evolutionSessionDropped: true,
        };
      }
    } catch {
      await supabaseServiceRole
        .from('list_cleaning_items')
        .update({
          whatsapp_status: 'unknown',
          verified_at: new Date().toISOString(),
          raw_payload: { error: 'verification_check_error' },
        })
        .eq('id', item.id);
    }

    processedNumbers += 1;
    currentSlot += 1;
    processedSession += 1;

    await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .update({
        processed_numbers: processedNumbers,
        current_slot: currentSlot,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runRow.id);

    await refreshJobCounts(jobId);

    const { count: pendingLeft } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .is('verified_at', null);

    if ((pendingLeft ?? 0) === 0) {
      await finalizeRunAndJob(jobId, runRow.id);
      return { stopped: false, runCompleted: true, processedSession };
    }

    const continueRunning = await sleepBetweenNumbersUnlessStopped(jobId, VERIFY_INTERVAL_MS);
    if (!continueRunning) {
      await refreshJobCounts(jobId);
      return { stopped: true, runCompleted: false, processedSession };
    }
  }
}

/**
 * Cria ou reutiliza um run para o job e inicia verificação (status running).
 */
export async function ensureRunForJob(jobId: string): Promise<{
  runId: string;
  totalNumbers: number;
  processedNumbers: number;
  alreadyRunning: boolean;
}> {
  const { count: pendingCount } = await supabaseServiceRole
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .is('verified_at', null);

  const total = pendingCount ?? 0;
  if (total === 0) {
    return { runId: '', totalNumbers: 0, processedNumbers: 0, alreadyRunning: false };
  }

  const { data: existing } = await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .select('id, total_numbers, processed_numbers, status')
    .eq('job_id', jobId)
    .single();

  if (existing) {
    /** Run já em execução na API — segue sem zerar progresso */
    if (existing.status === 'running') {
      return {
        runId: existing.id,
        totalNumbers: Math.max(existing.total_numbers ?? 0, total),
        processedNumbers: existing.processed_numbers ?? 0,
        alreadyRunning: true,
      };
    }
    /**
     * Qualquer outro estado (pending, completed, error, etc.) com itens pendentes:
     * precisa voltar para `running`, senão `runListCleaningVerificationUntilStoppedOrDone`
     * não encontra o run e não processa nenhum número.
     */
    const { error: upErr } = await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .update({
        total_numbers: total,
        processed_numbers: 0,
        current_slot: 0,
        status: 'running',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (upErr) throw new Error(upErr.message);
    return { runId: existing.id, totalNumbers: total, processedNumbers: 0, alreadyRunning: false };
  }

  const { data: inserted, error } = await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .insert({
      job_id: jobId,
      total_numbers: total,
      processed_numbers: 0,
      status: 'running',
      current_slot: 0,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? 'Erro ao criar run');
  }
  return { runId: inserted.id, totalNumbers: total, processedNumbers: 0, alreadyRunning: false };
}
