-- Corrige "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- Índices únicos parciais (WHERE) não são reconhecidos pelo upsert do PostgREST/Supabase.
-- Adicionamos uma coluna gerada conflict_key e um UNIQUE não parcial para o upsert funcionar.

-- 1. Coluna gerada: identifica o canal (Evolution ou WhatsApp Oficial) para unicidade
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS conflict_key TEXT GENERATED ALWAYS AS (
    CASE
      WHEN instance_id IS NOT NULL THEN 'i-' || instance_id::text
      WHEN whatsapp_config_id IS NOT NULL THEN 'w-' || whatsapp_config_id::text
      ELSE NULL
    END
  ) STORED;

-- 2. Garantir que linhas válidas tenham conflict_key (pelo menos um dos dois deve estar preenchido)
--    Não criamos CHECK para não quebrar dados existentes; o app já envia sempre um dos dois.

-- 3. Índice único não parcial (PostgREST/Supabase só reconhece assim para ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_conflict_key_remote_jid
  ON public.chat_conversations (conflict_key, remote_jid);

-- 4. Comentar para documentar
COMMENT ON COLUMN public.chat_conversations.conflict_key IS 'Chave para upsert: i-{instance_id} ou w-{whatsapp_config_id}. Usado em ON CONFLICT.';
