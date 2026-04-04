/**
 * Remove lock em master_instances quando o maturation_jobs vinculado não está mais ativo.
 * Evita UI "Em uso (bloqueada por outro job) · Sem campanha" com nada rodando.
 */

import { SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'paused']);

export async function reconcileOrphanedMasterInstanceLocks(supabase: SupabaseClient): Promise<number> {
  const { data: lockedMasters, error } = await supabase
    .from('master_instances')
    .select('id, locked_job_id')
    .eq('is_active', true)
    .eq('is_locked', true)
    .not('locked_job_id', 'is', null);

  if (error || !lockedMasters?.length) return 0;

  const jobIds = [...new Set(lockedMasters.map((r) => r.locked_job_id).filter(Boolean))] as string[];
  if (jobIds.length === 0) return 0;

  const { data: jobs } = await supabase.from('maturation_jobs').select('id, status').in('id', jobIds);
  const statusByJobId = new Map((jobs || []).map((j) => [j.id, j.status]));

  const staleMasterIds: string[] = [];
  for (const row of lockedMasters) {
    const jid = row.locked_job_id as string;
    const st = statusByJobId.get(jid);
    const stillActive = st != null && ACTIVE_JOB_STATUSES.has(st);
    if (!stillActive) {
      staleMasterIds.push(row.id);
    }
  }

  if (staleMasterIds.length === 0) return 0;

  const { error: upErr } = await supabase
    .from('master_instances')
    .update({ is_locked: false, locked_job_id: null, locked_at: null })
    .in('id', staleMasterIds);

  if (upErr) {
    console.warn('[maturation] reconcileOrphanedMasterInstanceLocks:', upErr.message);
    return 0;
  }

  return staleMasterIds.length;
}
