import { supabaseServiceRole } from './supabase-service';

function phoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function externalId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export type ChatLeadSource = 'whatsapp_official' | 'evolution' | 'chat';

/**
 * Vincula idempotentemente uma conversa de chat a um lead pendente do mesmo tenant.
 * Novos leads entram sem gerente/captador (user_id e gerente_id null) com nome + telefone.
 */
export async function ensurePendingLeadForConversation(input: {
  conversationId: string;
  tenantId: string | null | undefined;
  phone: string;
  name?: string | null;
  source?: ChatLeadSource;
}): Promise<string | null> {
  const tenantId = input.tenantId?.trim();
  const phone = phoneDigits(input.phone);
  if (!tenantId || !phone || phone.length < 8) return null;

  const { data: conversation } = await supabaseServiceRole
    .from('chat_conversations')
    .select('lead_id')
    .eq('id', input.conversationId)
    .single();
  if (conversation?.lead_id) return conversation.lead_id as string;

  const { data: candidates, error: findError } = await supabaseServiceRole
    .from('crm_leads')
    .select('id, phone, chat_conversation_id, name')
    .eq('zaploto_id', tenantId)
    .limit(5000);
  if (findError) throw findError;

  let leadId = (candidates ?? []).find((row) => phoneDigits(row.phone || '') === phone)?.id as
    | string
    | undefined;

  const displayName = input.name?.trim() || phone;

  if (!leadId) {
    const now = new Date().toISOString();
    const { data: created, error } = await supabaseServiceRole
      .from('crm_leads')
      .insert({
        external_id: externalId(),
        user_id: null,
        gerente_id: null,
        name: displayName,
        phone,
        status: 'novo',
        capture_status: 'pendente',
        source: input.source || 'chat',
        zaploto_id: tenantId,
        chat_conversation_id: input.conversationId,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error || !created) throw error || new Error('Falha ao criar lead da conversa.');
    leadId = created.id;
  } else {
    const existing = (candidates ?? []).find((row) => row.id === leadId);
    const patch: Record<string, unknown> = {
      chat_conversation_id: input.conversationId,
      updated_at: new Date().toISOString(),
    };
    // Preenche nome se o lead só tinha o telefone
    if (displayName && displayName !== phone) {
      const currentName = String(existing?.name || '').trim();
      if (!currentName || currentName === phone) patch.name = displayName;
    }
    await supabaseServiceRole.from('crm_leads').update(patch).eq('id', leadId);
  }

  if (!leadId) throw new Error('Não foi possível vincular o lead à conversa.');

  const { error: linkError } = await supabaseServiceRole
    .from('chat_conversations')
    .update({
      lead_id: leadId,
      workspace_id: tenantId,
      assignment_status: 'pendente',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId);
  if (linkError) throw linkError;
  return leadId;
}

/** Alias usado pelo webhook do WhatsApp Oficial (Meta). */
export async function ensurePendingLeadForOfficialConversation(input: {
  conversationId: string;
  tenantId: string | null | undefined;
  phone: string;
  name?: string | null;
}): Promise<string | null> {
  return ensurePendingLeadForConversation({
    ...input,
    source: 'whatsapp_official',
  });
}

/** Resolve zaploto_id do tenant a partir do dono da instância Evolution, se workspace_id estiver vazio. */
export async function resolveTenantIdForChatLead(input: {
  workspaceId?: string | null;
  ownerUserId?: string | null;
}): Promise<string | null> {
  const fromWorkspace = input.workspaceId?.trim();
  if (fromWorkspace) return fromWorkspace;
  const ownerId = input.ownerUserId?.trim();
  if (!ownerId) return null;
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .eq('id', ownerId)
    .maybeSingle();
  return (profile as { zaploto_id?: string | null } | null)?.zaploto_id ?? null;
}
