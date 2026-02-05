-- =====================================================
-- Migration: Adicionar status 'paused' em message_schedules
-- Data: 2025
-- Descrição: Adiciona status 'paused' para permitir pausar agendamentos
-- =====================================================

-- Remove a constraint antiga
ALTER TABLE message_schedules
DROP CONSTRAINT IF EXISTS message_schedules_status_check;

-- Adiciona a nova constraint com 'paused'
ALTER TABLE message_schedules
ADD CONSTRAINT message_schedules_status_check 
CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled', 'paused'));

