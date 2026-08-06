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

/**
 * Preenche workspace_id nulo a partir da instância/config — evita "fora do seu escopo"
 * em conversas listadas no chat mas sem tenant gravado.
 * Não exige gerente/captador online.
 */
async function healConversationWorkspaces(
  conversationIds: string[],
  actorZaplotoId: string | null
): Promise<void> {
  const { data: conversations } = await supabaseServiceRole
    .from('chat_conversations')
    .select('id, workspace_id, instance_id, whatsapp_config_id')
    .in('id', conversationIds);

  const missing = (conversations ?? []).filter((c) => !c.workspace_id);
  if (missing.length === 0) return;

  const instanceIds = [
    ...new Set(missing.map((c) => c.instance_id).filter((id): id is string => !!id)),
  ];
  const configIds = [
    ...new Set(missing.map((c) => c.whatsapp_config_id).filter((id): id is string => !!id)),
  ];

  const instanceWorkspace = new Map<string, string | null>();
  const configWorkspace = new Map<string, string | null>();

  if (instanceIds.length > 0) {
    const { data: instances } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, workspace_id')
      .in('id', instanceIds);
    for (const row of instances ?? []) {
      instanceWorkspace.set(row.id, row.workspace_id ?? null);
    }
  }
  if (configIds.length > 0) {
    const { data: configs } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id')
      .in('id', configIds);
    for (const row of configs ?? []) {
      configWorkspace.set(row.id, row.zaploto_id ?? null);
    }
  }

  await Promise.all(
    missing.map(async (c) => {
      const workspace =
        (c.instance_id ? instanceWorkspace.get(c.instance_id) : null) ||
        (c.whatsapp_config_id ? configWorkspace.get(c.whatsapp_config_id) : null) ||
        actorZaplotoId;
      if (!workspace) return;
      await supabaseServiceRole
        .from('chat_conversations')
        .update({ workspace_id: workspace, updated_at: new Date().toISOString() })
        .eq('id', c.id)
        .is('workspace_id', null);
    })
  );
}

export async function assignConversations(input: {
  actorUserId: string;
  conversationIds: string[];
  assigneeUserId: string;
}): Promise<number> {
  const ids = [...new Set(input.conversationIds)].slice(0, 101);
  if (ids.length === 0 || ids.length > 100) throw new Error('Informe entre 1 e 100 conversas.');

  const actor = await getChatActor(input.actorUserId);
  await healConversationWorkspaces(ids, actor.zaploto_id);

  const { data, error } = await supabaseServiceRole.rpc('chat_assign_conversations', {
    p_actor_user_id: input.actorUserId,
    p_conversation_ids: ids,
    p_assignee_user_id: input.assigneeUserId,
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}

/**
 * Destinatários possíveis para o modal de atribuição, respeitando a hierarquia:
 * admin/super_admin só atribuem para gerente; gerente só atribui para captador do seu time
 * (enroller = gerente). Online/offline é só indicador visual — atribuição é permitida offline.
 */
export async function listAssignmentTargets(actor: ChatActor) {
  if (!['super_admin', 'admin', 'gerente'].includes(actor.status)) return [];
  const targetStatus = actor.status === 'gerente' ? 'captador' : 'gerente';

  let query = supabaseServiceRole
    .from('profiles')
    .select('id, full_name, username, status, enroller, zaploto_id, last_seen_at')
    .eq('status', targetStatus)
    .eq('zaploto_id', actor.zaploto_id);
  if (actor.status === 'gerente') query = query.eq('enroller', actor.id);

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
