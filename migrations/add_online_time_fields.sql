-- =====================================================
-- Migration: Adicionar campos de rastreamento de tempo online
-- Data: 2024
-- Descrição: Adiciona last_seen_at e total_online_time na tabela profiles
-- =====================================================

-- Adiciona colunas de rastreamento
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS total_online_time INTEGER DEFAULT 0;

-- Comentários nas colunas para documentação
COMMENT ON COLUMN profiles.last_seen_at IS 'Última vez que o usuário foi visto ativo na plataforma';
COMMENT ON COLUMN profiles.total_online_time IS 'Tempo total logado na plataforma em segundos';

-- =====================================================
-- Validação: Verifica se as colunas foram criadas
-- =====================================================
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'profiles' AND column_name IN ('last_seen_at', 'total_online_time');

