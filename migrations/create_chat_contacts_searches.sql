-- =====================================================
-- Contatos do chat interno (searches)
-- Garante a estrutura para salvar contatos vindos do chat.
-- A API /api/chat/contacts usa a tabela searches (user_id, telefone, name, horario).
-- =====================================================

-- Cria a tabela searches se não existir (estrutura mínima para contatos do chat)
-- Se a tabela já existir (ex.: com id_list, block_list, etc.), nada é alterado.
CREATE TABLE IF NOT EXISTS public.searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    name TEXT,
    horario TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Garante colunas usadas pelo chat (idempotente; não falha se já existirem)
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS horario TEXT;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Índice único: um número por usuário (evita duplicata ao salvar contato do chat)
CREATE UNIQUE INDEX IF NOT EXISTS idx_searches_user_telefone
    ON public.searches (user_id, telefone);

-- Índices para listar contatos do usuário e buscar por telefone
CREATE INDEX IF NOT EXISTS idx_searches_user_id ON public.searches (user_id);
CREATE INDEX IF NOT EXISTS idx_searches_telefone ON public.searches (telefone);

-- Comentários
COMMENT ON TABLE public.searches IS 'Contatos do usuário; usada pelo chat interno (Salvar/Editar contato) e por campanhas/CRM.';
COMMENT ON COLUMN public.searches.telefone IS 'Número normalizado (apenas dígitos)';
COMMENT ON COLUMN public.searches.name IS 'Nome do contato (ex.: da conversa do chat)';
COMMENT ON COLUMN public.searches.horario IS 'Horário de atendimento/preferência do contato (ex: "Manhã (08h–12h)")';
