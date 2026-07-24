import { supabaseServiceRole } from './supabase-service';

function phoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function externalId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/** Vincula idempotentemente uma conversa oficial a um lead pendente do mesmo tenant. */
export async function ensurePendingLeadForOfficialConversation(input: {
  conversationId: string;
  tenantId: string | null | undefined;
  phone: string;
  name?: string | null;
}): Promise<string | null> {
  const tenantId = input.tenantId?.trim();
  const phone = phoneDigits(input.phone);
  if (!tenantId || !phone) return null;

  const { data: conversation } = await supabaseServiceRole
    .from('chat_conversations')
    .select('lead_id')
    .eq('id', input.conversationId)
    .single();
  if (conversation?.lead_id) return conversation.lead_id as string;

  const { data: candidates, error: findError } = await supabaseServiceRole
    .from('crm_leads')
    .select('id, phone, chat_conversation_id')
    .eq('zaploto_id', tenantId)
    .limit(5000);
  if (findError) throw findError;

  let leadId = (candidates ?? []).find((row) => phoneDigits(row.phone || '') === phone)?.id as
    | string
    | undefined;

  if (!leadId) {
    const now = new Date().toISOString();
    const { data: created, error } = await supabaseServiceRole
      .from('crm_leads')
      .insert({
        external_id: externalId(),
        user_id: null,
        gerente_id: null,
        name: input.name?.trim() || phone,
        phone,
        status: 'novo',
        capture_status: 'pendente',
        source: 'whatsapp_official',
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
    await supabaseServiceRole
      .from('crm_leads')
      .update({ chat_conversation_id: input.conversationId, updated_at: new Date().toISOString() })
      .eq('id', leadId);
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
