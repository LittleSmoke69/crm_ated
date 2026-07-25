/**
 * Regras de visibilidade de conversas do WhatsApp Oficial, espelhando a hierarquia
 * de atribuição (admin atribui a gerente, gerente atribui a captador do seu time):
 * admin/super_admin veem tudo (escopado ao tenant, exceto super_admin); gerente vê
 * as suas (aguardando repasse) e as dos captadores do seu time (profiles.enroller);
 * captador vê só as suas.
 */
import { supabaseServiceRole } from './supabase-service';

/** IDs dos captadores do time de um gerente (profiles.enroller = gerenteId). */
export async function getGerenteTeamCaptadorIds(gerenteId: string): Promise<string[]> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id')
    .eq('status', 'captador')
    .eq('enroller', gerenteId);
  return (data ?? []).map((p) => p.id as string);
}

/** Expressão `.or()` do PostgREST para a listagem: conversas do gerente + dos captadores do time. */
export function gerenteOfficialOrFilter(gerenteId: string, teamCaptadorIds: string[]): string {
  const parts = [`gerente_id.eq.${gerenteId}`];
  if (teamCaptadorIds.length > 0) {
    parts.push(`user_id.in.(${teamCaptadorIds.join(',')})`);
  }
  return parts.join(',');
}

/** Verifica, para uma conversa específica, se um gerente pode vê-la (mensagens, presença). */
export async function gerenteCanSeeOfficialConversation(
  gerenteId: string,
  conv: { gerente_id?: string | null; user_id?: string | null }
): Promise<boolean> {
  if (conv.gerente_id === gerenteId) return true;
  if (!conv.user_id) return false;
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id')
    .eq('id', conv.user_id)
    .eq('enroller', gerenteId)
    .maybeSingle();
  return !!data;
}
