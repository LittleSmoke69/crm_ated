import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ao upsertar conversa a partir da Evolution (webhook), preserva `user_id` já gravado
 * (ex.: disparo em massa com instância de outro usuário atribui ao criador do job).
 */
export async function resolveEvolutionConversationUserIdForUpsert(
  supabase: SupabaseClient,
  instanceId: string,
  remoteJid: string,
  instanceOwnerUserId: string | null | undefined
): Promise<string | undefined> {
  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('user_id')
    .eq('instance_id', instanceId)
    .eq('remote_jid', remoteJid)
    .maybeSingle();
  const u = existing?.user_id;
  if (u != null && String(u).length > 0) return String(u);
  return instanceOwnerUserId ?? undefined;
}
