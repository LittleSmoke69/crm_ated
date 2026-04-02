import type { SupabaseClient } from '@supabase/supabase-js';

/** JID de grupo estável para idempotência (trim, minúsculas, sufixo @g.us quando for só dígitos/hífen). */
export function normalizeMassSendGroupId(raw: unknown): string {
  let s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower.includes('@')) return lower;
  if (/^[\d-]{6,}$/.test(lower)) return `${lower}@g.us`;
  return lower;
}

function massSendGroupIdVariants(groupId: string): string[] {
  const gid = normalizeMassSendGroupId(groupId);
  if (!gid) return [];
  const v = new Set<string>([gid]);
  if (gid.endsWith('@g.us')) v.add(gid.replace(/@g\.us$/i, ''));
  else if (/^[\d-]{6,}$/.test(gid)) v.add(`${gid}@g.us`);
  return [...v];
}

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
  const variants = massSendGroupIdVariants(groupId);
  if (variants.length === 0 || !jobId) return false;
  const { data, error } = await client
    .from('activation_mass_send_job_groups')
    .select('success')
    .eq('job_id', jobId)
    .eq('success', true)
    .in('group_id', variants)
    .limit(1);
  if (error || !data?.length) return false;
  return data[0].success === true;
}

const IN_FLIGHT_POLL_MS = 2500;
const IN_FLIGHT_MAX_POLLS = 240;

/**
 * Reserva (job_id, group_id) no banco antes do POST à Evolution.
 * Retorno: send = pode enviar; already_ok = não enviar; invalid_group = group id vazio.
 */
export async function claimMassSendGroupBeforeSend(
  client: SupabaseClient,
  jobId: string,
  groupId: string
): Promise<'send' | 'already_ok' | 'invalid_group'> {
  const gid = normalizeMassSendGroupId(groupId);
  if (!gid) return 'invalid_group';

  for (let i = 0; i < IN_FLIGHT_MAX_POLLS; i++) {
    const { data, error } = await client.rpc('claim_activation_mass_send_group', {
      p_job_id: jobId,
      p_group_id: gid,
      p_now: new Date().toISOString(),
      p_in_flight_stale_seconds: 900,
    });

    if (error) {
      console.error('[MassSend] claim_activation_mass_send_group:', error.message);
      return 'send';
    }

    const v = String(data ?? '').trim();
    if (v === 'already_ok') return 'already_ok';
    if (v === 'invalid_group') return 'invalid_group';
    if (v === 'send') return 'send';
    if (v === 'in_flight') {
      await new Promise((r) => setTimeout(r, IN_FLIGHT_POLL_MS));
      continue;
    }
    return 'send';
  }

  const { data: last } = await client.rpc('claim_activation_mass_send_group', {
    p_job_id: jobId,
    p_group_id: gid,
    p_now: new Date().toISOString(),
    p_in_flight_stale_seconds: 60,
  });
  return String(last ?? '').trim() === 'already_ok' ? 'already_ok' : 'send';
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
