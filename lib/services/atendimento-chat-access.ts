import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeConsultorUserIdsColumn } from '@/lib/utils/atendimento-consultores';

export type AtendimentoChatProfile = {
  status?: string | null;
};

/**
 * Permite acesso às conversas/mensagens/envio Evolution do chat quando:
 * - admin / super_admin / suporte; ou
 * - dono da instância (evolution_instances.user_id); ou
 * - existe vínculo em atendimento_chat_assignments (gerente ou consultor atribuído).
 */
export async function canUserAccessEvolutionChatInstance(
  userId: string,
  profile: AtendimentoChatProfile,
  instanceId: string
): Promise<boolean> {
  const status = (profile.status || '').trim().toLowerCase();
  if (status === 'super_admin' || status === 'admin' || status === 'suporte') {
    return true;
  }

  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, user_id, is_chat_instance, is_master')
    .eq('id', instanceId)
    .maybeSingle();

  if (error || !instance) return false;

  // Dono da instância tem acesso irrestrito — independente de is_chat_instance
  if (instance.user_id === userId) {
    return true;
  }

  const { data: row } = await supabaseServiceRole
    .from('atendimento_chat_assignments')
    .select('gerente_user_id, consultor_user_ids')
    .eq('evolution_instance_id', instanceId)
    .maybeSingle();

  if (!row) return false;
  if (row.gerente_user_id === userId) return true;
  const consultores = normalizeConsultorUserIdsColumn(
    (row as { consultor_user_ids?: unknown }).consultor_user_ids
  );
  if (consultores.includes(userId)) return true;
  return false;
}
