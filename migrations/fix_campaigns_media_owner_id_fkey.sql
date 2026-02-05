-- =====================================================
-- Migration: Corrigir foreign key de campaigns_media
-- Data: 2024
-- Descrição: Corrige a foreign key owner_id para referenciar profiles(id) ao invés de auth.users(id)
-- IMPORTANTE: Execute esta migration se a tabela campaigns_media já foi criada com a referência errada
-- =====================================================

-- Remove a constraint antiga se existir (pode ter nomes diferentes)
DO $$ 
BEGIN
  -- Tenta remover com o nome padrão
  ALTER TABLE campaigns_media DROP CONSTRAINT IF EXISTS campaigns_media_owner_id_fkey;
  
  -- Tenta remover outras possíveis variações
  ALTER TABLE campaigns_media DROP CONSTRAINT IF EXISTS campaigns_media_owner_id_users_id_fkey;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignora se a constraint não existir
    RAISE NOTICE 'Constraint não encontrada ou já removida';
END $$;

-- Adiciona a constraint correta referenciando profiles(id)
ALTER TABLE campaigns_media 
ADD CONSTRAINT campaigns_media_owner_id_fkey 
FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- =====================================================
-- Validação: Verifica se a constraint foi criada corretamente
-- =====================================================
-- Execute para verificar:
-- SELECT 
--   tc.constraint_name, 
--   tc.table_name, 
--   kcu.column_name,
--   ccu.table_name AS foreign_table_name,
--   ccu.column_name AS foreign_column_name 
-- FROM information_schema.table_constraints AS tc 
-- JOIN information_schema.key_column_usage AS kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--   ON ccu.constraint_name = tc.constraint_name
-- WHERE tc.table_name = 'campaigns_media' 
--   AND tc.constraint_type = 'FOREIGN KEY';

