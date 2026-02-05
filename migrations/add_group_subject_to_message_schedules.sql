-- =====================================================
-- Migration: Adicionar group_subject em message_schedules
-- Data: 2025
-- Descrição: Adiciona campo group_subject para armazenar o nome do grupo
-- =====================================================

-- Adiciona coluna group_subject
ALTER TABLE message_schedules
ADD COLUMN IF NOT EXISTS group_subject TEXT;

-- Comentário
COMMENT ON COLUMN message_schedules.group_subject IS 'Nome do grupo (para exibição, group_id é usado para envio)';

