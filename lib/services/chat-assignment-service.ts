import { supabaseServiceRole } from './supabase-service';

export type ChatActor = {
  id: string;
  status: string;
  zaploto_id: string | null;
  enroller: string | null;
};

export async function getChatActor(userId: string): Promise<ChatActor> {
  const { data, error } = await supabaseServiceRole
    .from('profiles')
    .select('id, status, zaploto_id, enroller')
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error('Perfil não encontrado.');
  return data as ChatActor;
}
export async function assignConversations(input: {
  actorUserId: string;
  conversationIds: string[];
  assigneeUserId: string;
}): Promise<number> {
  const ids = [...new Set(input.conversationIds)].slice(0, 101);
  if (ids.length === 0 || ids.length > 100) throw new Error('Informe entre 1 e 100 conversas.');
  const { data, error } = await supabaseServiceRole.rpc('chat_assign_conversations', {
    p_actor_user_id: input.actorUserId,
    p_conversation_ids: ids,
    p_assignee_user_id: input.assigneeUserId,
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}

export async function listAvailableCaptadores(actor: ChatActor) {
  let query = supabaseServiceRole
    .from('profiles')
    .select('id, full_name, username, status, enroller, zaploto_id, last_seen_at')
    .eq('status', 'captador')
    .eq('zaploto_id', actor.zaploto_id);
  if (actor.status === 'gerente') query = query.eq('enroller', actor.id);
  if (!['super_admin', 'admin', 'gerente'].includes(actor.status)) return [];

  const { data, error } = await query.order('full_name');
  if (error) throw error;
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: settings } = await supabaseServiceRole
    .from('user_settings')
    .select('user_id, is_active')
    .in('user_id', ids);
  const active = new Map((settings ?? []).map((s) => [s.user_id, s.is_active !== false]));
  return (data ?? []).filter((p) => active.get(p.id) !== false);
}
