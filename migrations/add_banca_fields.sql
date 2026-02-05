-- =====================================================
-- Migration: Adicionar campos de banca na tabela profiles
-- Data: 2024
-- Descrição: Adiciona banca_name e banca_url para Donos de Banca
-- =====================================================

-- Adiciona colunas banca_name e banca_url (nullable)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS banca_name TEXT,
ADD COLUMN IF NOT EXISTS banca_url TEXT;

-- Comentários nas colunas para documentação
COMMENT ON COLUMN profiles.banca_name IS 'Nome da banca (específico para status dono_banca)';
COMMENT ON COLUMN profiles.banca_url IS 'URL da banca (específico para status dono_banca)';

-- =====================================================
-- Validação: Verifica se as colunas foram criadas
-- =====================================================
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'profiles' AND column_name IN ('banca_name', 'banca_url');

