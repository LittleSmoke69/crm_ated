-- =====================================================
-- Migration: Adicionar campo enroller na tabela profiles
-- Data: 2024
-- Descrição: Adiciona campo enroller para suportar hierarquia de usuários
-- =====================================================

-- Adiciona coluna enroller (pode ser NULL para Admin e Dono de banca sem superior)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS enroller UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Cria índice para melhorar performance de consultas hierárquicas
CREATE INDEX IF NOT EXISTS idx_profiles_enroller ON profiles(enroller);

-- Cria índice composto para consultas por status e enroller
CREATE INDEX IF NOT EXISTS idx_profiles_status_enroller ON profiles(status, enroller);

-- Comentário na coluna para documentação
COMMENT ON COLUMN profiles.enroller IS 'ID do usuário superior na hierarquia. NULL para Admin ou Dono de banca sem superior. Consultor -> Gerente -> Dono de banca';

-- =====================================================
-- Validação: Verifica se a coluna foi criada corretamente
-- =====================================================
-- Execute para verificar:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'profiles' AND column_name = 'enroller';

