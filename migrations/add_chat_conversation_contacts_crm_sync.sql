-- CRM ↔ Chat Atendimento: origem do contato (kanban permanente na lista; transferidos sincronizados e removidos quando saem do CRM)
ALTER TABLE public.chat_conversation_contacts
  ADD COLUMN IF NOT EXISTS crm_sync_kind TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS crm_external_id TEXT,
  ADD COLUMN IF NOT EXISTS crm_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS is_pinned_manual BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.chat_conversation_contacts DROP CONSTRAINT IF EXISTS chat_conversation_contacts_crm_sync_kind_check;
ALTER TABLE public.chat_conversation_contacts
  ADD CONSTRAINT chat_conversation_contacts_crm_sync_kind_check
  CHECK (crm_sync_kind IN ('manual', 'kanban', 'transferred'));

COMMENT ON COLUMN public.chat_conversation_contacts.crm_sync_kind IS 'manual: salvo pelo consultor; kanban: espelho CRM kanban (não remove ao sair do funil); transferred: espelho CRM transferidos (removido na sync se sumir do CRM).';
COMMENT ON COLUMN public.chat_conversation_contacts.crm_snapshot IS 'JSON com resumo para card no chat (status, banca, temperatura, totais).';
COMMENT ON COLUMN public.chat_conversation_contacts.is_pinned_manual IS 'true quando o consultor salvou/editou o contato no chat; sync não apaga e preserva nome/horário preferencialmente.';

CREATE INDEX IF NOT EXISTS idx_chat_conversation_contacts_user_crm_kind
  ON public.chat_conversation_contacts (user_id, crm_sync_kind);

-- Contatos já existentes (salvos pelo chat antes desta migração) tratados como fixados para não serem apagados por sync de transferidos.
UPDATE public.chat_conversation_contacts
SET is_pinned_manual = true
WHERE is_pinned_manual IS NOT TRUE;
