/**
 * Processa um único slot de verificação (máx 10 números, delay 1.2–1.5s).
 * Cada execução deve durar no máximo ~20s para evitar timeout no Netlify.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkWhatsAppForListCleaning } from '@/lib/services/whatsapp-check-service';

const LOG_PREFIX = '[list-cleaning-slot]';

/** Máximo de números por slot (execução ~15–20s com delay 1.2–1.5s). */
export const SLOT_SIZE = 10;

const DELAY_MS_MIN = 1200;
const DELAY_MS_MAX = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelayMs(): number {
  return DELAY_MS_MIN + Math.floor(Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN + 1));
}

export interface ProcessSlotResult {
  processed: number;
  validated: number;
  notValidated: number;
  unknown: number;
  hasMore: boolean;
  runCompleted: boolean;
}

/**
 * Processa um slot de até SLOT_SIZE números para o job, atualiza itens e run.
 * Retorna rápido; não processa mais de SLOT_SIZE números.
 */
export async function processOneSlot(jobId: string): Promise<ProcessSlotResult> {
  const apiKey = process.env.WASENDER_API_KEY || '';
  if (!apiKey) {
    return { processed: 0, validated: 0, notValidated: 0, unknown: 0, hasMore: false, runCompleted: false };
  }

  const { data: run, error: runError } = await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .select('id, job_id, total_numbers, processed_numbers, current_slot, status')
    .eq('job_id', jobId)
    .eq('status', 'running')
    .single();

  if (runError || !run) {
    return { processed: 0, validated: 0, notValidated: 0, unknown: 0, hasMore: false, runCompleted: false };
  }

  const { data: pendingItems, error: pendingError } = await supabaseServiceRole
    .from('list_cleaning_items')
    .select('id, phone')
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .is('verified_at', null)
    .order('created_at', { ascending: true })
    .limit(SLOT_SIZE);

  if (pendingError || !pendingItems?.length) {
    await finalizeRunAndJob(jobId, run.id);
    return {
      processed: 0,
      validated: 0,
      notValidated: 0,
      unknown: 0,
      hasMore: false,
      runCompleted: true,
    };
  }

  let validated = 0;
  let notValidated = 0;
  let unknown = 0;

  for (const item of pendingItems) {
    try {
      const result = await checkWhatsAppForListCleaning(item.phone);
      await supabaseServiceRole
        .from('list_cleaning_items')
        .update({
          whatsapp_status: result.status,
          verified_at: new Date().toISOString(),
          raw_payload: result.raw as unknown as Record<string, unknown>,
        })
        .eq('id', item.id);

      if (result.status === 'active') validated++;
      else if (result.status === 'inactive') notValidated++;
      else unknown++;
    } catch {
      unknown++;
      await supabaseServiceRole
        .from('list_cleaning_items')
        .update({
          whatsapp_status: 'unknown',
          verified_at: new Date().toISOString(),
          raw_payload: { error: 'slot_check_error' },
        })
        .eq('id', item.id);
    }
    await sleep(getRandomDelayMs());
  }

  const newProcessed = run.processed_numbers + pendingItems.length;
  const hasMore = newProcessed < run.total_numbers;

  await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .update({
      processed_numbers: newProcessed,
      current_slot: run.current_slot + 1,
      status: hasMore ? 'running' : 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id);

  await refreshJobCounts(jobId);

  if (!hasMore) {
    await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', run.id);
    await supabaseServiceRole
      .from('list_cleaning_jobs')
      .update({ status: 'done', pending_count: 0, next_run_at: null, updated_at: new Date().toISOString() })
      .eq('id', jobId);
  }

  return {
    processed: pendingItems.length,
    validated,
    notValidated,
    unknown,
    hasMore,
    runCompleted: !hasMore,
  };
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
    .update({ status: 'done', pending_count: 0, next_run_at: null, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

/**
 * Cria ou reutiliza um run para o job e inicia verificação (status running).
 * Um job tem no máximo um run (UNIQUE job_id); se completed, reabre com novos totais.
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

  const { data: job } = await supabaseServiceRole
    .from('list_cleaning_jobs')
    .select('total_unique')
    .eq('id', jobId)
    .single();
  const { data: existing } = await supabaseServiceRole
    .from('list_cleaning_verification_runs')
    .select('id, total_numbers, processed_numbers, status')
    .eq('job_id', jobId)
    .single();

  if (existing) {
    if (existing.status === 'running') {
      return {
        runId: existing.id,
        totalNumbers: existing.total_numbers,
        processedNumbers: existing.processed_numbers,
        alreadyRunning: true,
      };
    }
    if (existing.status === 'completed' && total > 0) {
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
    return { runId: existing.id, totalNumbers: existing.total_numbers, processedNumbers: existing.processed_numbers, alreadyRunning: false };
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
