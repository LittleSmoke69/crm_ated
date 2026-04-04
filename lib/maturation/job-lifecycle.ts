/**
 * Ciclo de vida de jobs de maturação: abort, auto‑virgem.
 */

import { SupabaseClient } from '@supabase/supabase-js';

/** Plano fixo do auto‑maturador (mensagens virgem). */
export const VIRGIN_AUTO_MATURATION_PLAN_ID = 'a0000000-0000-0000-0000-000000000001';

/** Marca steps ainda não enviados como skipped (evita reprocessamento após abort). */
export async function skipOpenStepsOnJobAbort(supabase: SupabaseClient, jobId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('maturation_steps')
    .update({
      status: 'skipped',
      error: 'Job abortado pelo usuário',
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('job_id', jobId)
    .in('status', ['pending', 'processing']);
  if (error) {
    console.warn('[maturation] skipOpenStepsOnJobAbort:', error.message);
  }
}

/**
 * Ao abortar um job do auto‑maturador, pausa a instância virgem para não recriar warmup imediatamente.
 * O admin/usuário retoma em Instâncias ou Admin > Maturador (despausar virgem).
 */
export async function pauseVirginInstanceAfterAutoJobAbort(
  supabase: SupabaseClient,
  masterInstanceId: string,
  planId: string
): Promise<void> {
  if (planId !== VIRGIN_AUTO_MATURATION_PLAN_ID) return;

  const { data: mi } = await supabase
    .from('master_instances')
    .select('evolution_instance_id')
    .eq('id', masterInstanceId)
    .maybeSingle();
  const evoId = mi?.evolution_instance_id;
  if (!evoId) return;

  const { data: inst } = await supabase
    .from('evolution_instances')
    .select('id, maturation_type, maturation_status')
    .eq('id', evoId)
    .maybeSingle();
  if (!inst || inst.maturation_type !== 'virgem') return;
  const st = inst.maturation_status;
  if (st === 'completed' || st === 'blocked') return;

  const now = new Date().toISOString();
  await supabase.from('evolution_instances').update({ maturation_paused_at: now, updated_at: now }).eq('id', evoId);
}
