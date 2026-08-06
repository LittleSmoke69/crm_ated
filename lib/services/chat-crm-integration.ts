import { supabaseServiceRole } from './supabase-service';
import type { AcquisitionTag } from '@/lib/crm/acquisition-tags';
import { isAcquisitionTag } from '@/lib/crm/acquisition-tags';

function phoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function externalId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/** Nome útil do contato (não é o próprio telefone / só dígitos). */
function resolveContactDisplayName(
  name: string | null | undefined,
  phone: string
): string | null {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const digits = phoneDigits(raw);
  if (digits && digits === phone) return null;
  if (/^\d{8,}$/.test(digits) && !/[A-Za-zÀ-ÿ]/.test(raw)) return null;
  return raw;
}

function isPhoneLikeName(name: string | null | undefined, phone: string): boolean {
  const raw = String(name || '').trim();
  if (!raw) return true;
  const digits = phoneDigits(raw);
  if (digits && digits === phone) return true;
  if (/^\d{8,}$/.test(digits) && !/[A-Za-zÀ-ÿ]/.test(raw)) return true;
  return false;
}

/** Busca o melhor título/nome já conhecido em conversas do mesmo telefone. */
async function findBestKnownContactName(phone: string): Promise<string | null> {
  if (!phone || phone.length < 8) return null;
  const { data } = await supabaseServiceRole
    .from('chat_conversations')
    .select('title, remote_jid')
    .ilike('remote_jid', `${phone}%`)
    .limit(20);
  let best: string | null = null;
  for (const row of data || []) {
    const title = resolveContactDisplayName(row.title as string | undefined, phone);
    if (!title) continue;
    if (!best || title.length > best.length) best = title;
  }
  return best;
}

export type ChatLeadSource = 'whatsapp_official' | 'evolution' | 'chat';

/**
 * Vincula idempotentemente uma conversa de chat a um lead pendente do mesmo tenant.
 * Novos leads entram sem gerente/captador (user_id e gerente_id null) com nome + telefone.
 * Se o payload trouxer nome, grava no campo name e o telefone em phone (ambos na tela Leads).
 * Tag padrão: ADS (chat atendimento). Disparo passa acquisitionTag='disparo'.
 */
export async function ensurePendingLeadForConversation(input: {
  conversationId: string;
  tenantId: string | null | undefined;
  phone: string;
  name?: string | null;
  source?: ChatLeadSource;
  /** ads (padrão) | disparo */
  acquisitionTag?: AcquisitionTag;
}): Promise<string | null> {
  const tenantId = input.tenantId?.trim();
  const phone = phoneDigits(input.phone);
  // Telefone WhatsApp BR típico: 12–13 dígitos. IDs @lid costumam ter 14+.
  if (!tenantId || !phone || phone.length < 8 || phone.length > 13) return null;

  const acquisitionTag: AcquisitionTag =
    input.acquisitionTag && isAcquisitionTag(input.acquisitionTag) ? input.acquisitionTag : 'ads';

  const { data: conversation } = await supabaseServiceRole
    .from('chat_conversations')
    .select('lead_id, title, remote_jid')
    .eq('id', input.conversationId)
    .single();

  const remoteJid = String(conversation?.remote_jid || '').toLowerCase();
  // Não criar lead a partir de JID interno @lid (sem telefone real).
  if (remoteJid.endsWith('@lid') || remoteJid.includes('@lid')) return null;

  const displayName =
    resolveContactDisplayName(input.name, phone) ||
    resolveContactDisplayName(conversation?.title as string | undefined, phone) ||
    (await findBestKnownContactName(phone));

  if (conversation?.lead_id) {
    const leadId = conversation.lead_id as string;
    // O contato do chat é a fonte do nome para leads criados pela integração.
    // Não altera responsável/status: enquanto não houver gerente nem captador,
    // o lead continua como "Não atribuído" na tela Leads. Após delegação no chat
    // (gerente_id preenchido), passa a "Aguardando captador".
    const { data: current } = await supabaseServiceRole
      .from('crm_leads')
      .select('name, phone, source, acquisition_tag')
      .eq('id', leadId)
      .maybeSingle();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const currentPhone = phoneDigits(current?.phone || '');
    if (!currentPhone || currentPhone !== phone) {
      patch.phone = phone;
    }
    if (displayName && isPhoneLikeName(current?.name as string | undefined, phone)) {
      patch.name = displayName;
    } else if (displayName && current?.source && ['evolution', 'whatsapp_official', 'chat'].includes(String(current.source))) {
      // Atualiza nome do payload quando o lead veio do chat (mantém edição manual de outras fontes)
      const cur = String(current?.name || '').trim();
      if (!cur || isPhoneLikeName(cur, phone)) patch.name = displayName;
    }
    // Tag: preenche se vazia; disparo não é sobrescrito por ads
    const currentTag = String(current?.acquisition_tag || '').trim();
    if (!currentTag) {
      patch.acquisition_tag = acquisitionTag;
    } else if (acquisitionTag === 'disparo' && currentTag !== 'disparo') {
      patch.acquisition_tag = 'disparo';
    }

    if (Object.keys(patch).length > 1) {
      const { error: nameError } = await supabaseServiceRole
        .from('crm_leads')
        .update(patch)
        .eq('id', leadId);
      if (nameError) throw nameError;
    }
    return leadId;
  }

  const { data: candidates, error: findError } = await supabaseServiceRole
    .from('crm_leads')
    .select('id, phone, chat_conversation_id, name, acquisition_tag')
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
        name: displayName,
        phone,
        status: 'novo',
        capture_status: 'pendente',
        source: input.source || 'chat',
        acquisition_tag: acquisitionTag,
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
      phone,
      updated_at: new Date().toISOString(),
    };
    // Preenche nome se o lead só tinha o telefone / estava vazio
    if (displayName && isPhoneLikeName(existing?.name as string | undefined, phone)) {
      patch.name = displayName;
    }
    const currentTag = String(existing?.acquisition_tag || '').trim();
    if (!currentTag) {
      patch.acquisition_tag = acquisitionTag;
    } else if (acquisitionTag === 'disparo' && currentTag !== 'disparo') {
      patch.acquisition_tag = 'disparo';
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
