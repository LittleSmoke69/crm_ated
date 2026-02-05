-- =====================================================
-- Migration: Adicionar coluna telefone na tabela profiles
-- Data: 2026-01-26
-- Descrição: Adiciona coluna telefone para armazenar número pessoal do usuário
-- =====================================================

-- Adiciona coluna telefone (nullable)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS telefone TEXT;

-- Comentário na coluna para documentação
COMMENT ON COLUMN profiles.telefone IS 'Número de telefone pessoal do usuário (formato: 5581999999999). Usado para envio de vídeos, comunicados e relatórios do zaploto.';

-- =====================================================
-- Validação: Verifica se a coluna foi criada
-- =====================================================
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'profiles' AND column_name = 'telefone';
