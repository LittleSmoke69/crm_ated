-- Migration: Adiciona coluna id_list na tabela searches
-- Data: 2026-01-07
-- Descrição: Vincula contatos às listas personalizadas através de chave estrangeira

-- Adiciona a coluna id_list na tabela searches
ALTER TABLE searches 
ADD COLUMN IF NOT EXISTS id_list UUID REFERENCES custom_contact_lists(id) ON DELETE SET NULL;

-- Cria índice para melhorar performance nas consultas
CREATE INDEX IF NOT EXISTS idx_searches_id_list ON searches(id_list);

-- Comentários
COMMENT ON COLUMN searches.id_list IS 'ID da lista personalizada à qual o contato pertence';

