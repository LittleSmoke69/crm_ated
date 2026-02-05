-- =====================================================
-- Migration: Corrigir foreign key de user_id em message_schedules
-- Data: 2025
-- Descrição: Corrige a foreign key de auth.users para profiles
-- =====================================================

-- Remove a constraint antiga (se existir)
DO $$
BEGIN
  -- Tenta remover a constraint antiga
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'message_schedules_user_id_fkey'
    AND table_name = 'message_schedules'
  ) THEN
    ALTER TABLE message_schedules 
    DROP CONSTRAINT message_schedules_user_id_fkey;
  END IF;
END $$;

-- Adiciona a constraint correta referenciando profiles
ALTER TABLE message_schedules
ADD CONSTRAINT message_schedules_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES profiles(id) 
ON DELETE CASCADE;

-- Verifica se a constraint foi criada corretamente
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'message_schedules_user_id_fkey'
    AND table_name = 'message_schedules'
  ) THEN
    RAISE NOTICE 'Foreign key corrigida com sucesso!';
  ELSE
    RAISE EXCEPTION 'Erro ao criar foreign key';
  END IF;
END $$;

