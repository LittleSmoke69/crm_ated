import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verifica no banco se o grupo já teve disparo com sucesso neste job.
 * Usar imediatamente antes do POST à Evolution evita duplicata quando outro worker
 * gravou entretanto ou quando o Set em memória está defasado.
 */
export async function hasMassSendGroupAlreadySucceeded(
  client: SupabaseClient,
  jobId: string,
  groupId: string
): Promise<boolean> {
  const gid = String(groupId ?? '').trim();
  if (!gid || !jobId) return false;
  const { data, error } = await client
    .from('activation_mass_send_job_groups')
    .select('success')
    .eq('job_id', jobId)
    .eq('group_id', gid)
    .eq('success', true)
    .maybeSingle();
  if (error || !data) return false;
  return data.success === true;
}

/**
 * Erros “transientes” que ainda permitem retry seguro (requisição provavelmente não foi aceita).
 * Não inclui timeout/abort: a Evolution pode ter processado o envio e aí o retry duplica no grupo.
 */
export function isMassSendTransientRetryable(error?: string): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  if (e.includes('timeout') || e.includes('abort')) return false;
  if (e.includes('evolution não respondeu')) return false;
  return (
    e.includes('fetch failed') ||
    e.includes('504') ||
    e.includes('502') ||
    e.includes('503') ||
    e.includes('econnreset') ||
    e.includes('econnrefused') ||
    e.includes('enotfound') ||
    e.includes('socket hang up')
  );
}
