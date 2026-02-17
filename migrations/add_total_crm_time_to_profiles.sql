-- =====================================================
-- Migration: Adicionar total_crm_time na tabela profiles
-- Data: 2026-02-17
-- Descrição: Tempo total (em segundos) que o usuário passou em páginas do CRM,
--            usado na hierarquia para exibir "Horas no CRM".
-- =====================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS total_crm_time INTEGER DEFAULT 0;

COMMENT ON COLUMN profiles.total_crm_time IS 'Tempo total em páginas do CRM em segundos (consultor, gerente, kanban, etc.)';
