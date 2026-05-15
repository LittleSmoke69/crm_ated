import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/** Libera claims antigos (ex.: processo morto após envio) para não travar o disparo. */
const STALE_CLAIM_MS = 3 * 60 * 1000;

/**
 * Evita dois processadores (runner no browser + cron `process-broadcast-queue`, ou duas abas)
 * enviarem o mesmo passo da sequência. Só um ganha o claim por (job, current_index, message_step_index).
 */
export async function tryClaimBroadcastStep(
  supabase: SupabaseClient,
  jobId: string,
  currentIndex: number,
  messageStepIndex: number
): Promise<{ ok: true; claimToken: string } | { ok: false }> {
  const claimToken = randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  await supabase
    .from('chat_broadcasts')
    .update({ step_claim_token: null, step_claim_at: null })
    .eq('id', jobId)
    .not('step_claim_token', 'is', null)
    .lt('step_claim_at', staleBefore);

  const { data, error } = await supabase
    .from('chat_broadcasts')
    .update({ step_claim_token: claimToken, step_claim_at: now })
    .eq('id', jobId)
    .eq('current_index', currentIndex)
    .eq('message_step_index', messageStepIndex)
    .is('step_claim_token', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false };
  return { ok: true, claimToken };
}

export async function releaseBroadcastStepClaim(
  supabase: SupabaseClient,
  jobId: string,
  claimToken: string
): Promise<void> {
  await supabase
    .from('chat_broadcasts')
    .update({ step_claim_token: null, step_claim_at: null })
    .eq('id', jobId)
    .eq('step_claim_token', claimToken);
}
