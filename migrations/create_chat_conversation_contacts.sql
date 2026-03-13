-- =====================================================
-- Contatos salvos a partir do chat interno
-- A API /api/chat/contacts usa esta tabela (não mais searches para o chat).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.chat_conversation_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    name TEXT,
    horario TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.chat_conversation_contacts IS 'Contatos salvos pelo usuário a partir do chat interno (Salvar/Editar contato).';
COMMENT ON COLUMN public.chat_conversation_contacts.telefone IS 'Número normalizado (apenas dígitos).';
COMMENT ON COLUMN public.chat_conversation_contacts.name IS 'Nome do contato.';
COMMENT ON COLUMN public.chat_conversation_contacts.horario IS 'Horário de atendimento/preferência (ex: "Manhã (08h–12h)").';

-- Um número por usuário (evita duplicata ao salvar contato do chat)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversation_contacts_user_telefone
    ON public.chat_conversation_contacts (user_id, telefone);

CREATE INDEX IF NOT EXISTS idx_chat_conversation_contacts_user_id
    ON public.chat_conversation_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_contacts_telefone
    ON public.chat_conversation_contacts (telefone);
