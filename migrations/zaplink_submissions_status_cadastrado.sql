-- =====================================================
-- Migration: Zaplink - Status 'cadastrado' para leads já existentes
-- Data: 2026-03-04
-- Descrição: Quando um lead já cadastrado no sistema é atribuído, o status passa a 'cadastrado'
--            em vez de 'assigned'. Permite card "Cadastrados" e distinção na listagem.
-- =====================================================

-- Remove a constraint antiga (nome pode variar; drop by check expression no PostgreSQL 12+)
ALTER TABLE zaplink_form_submissions
  DROP CONSTRAINT IF EXISTS zaplink_form_submissions_status_check;

-- Adiciona nova constraint permitindo 'pending', 'assigned' e 'cadastrado'
ALTER TABLE zaplink_form_submissions
  ADD CONSTRAINT zaplink_form_submissions_status_check
  CHECK (status IN ('pending', 'assigned', 'cadastrado'));

COMMENT ON COLUMN zaplink_form_submissions.status IS 'pending = aguardando atribuição; assigned = novo consultor criado; cadastrado = já existia no sistema e foi vinculado';
