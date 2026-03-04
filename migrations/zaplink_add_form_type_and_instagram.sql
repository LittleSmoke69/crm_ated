-- =====================================================
-- Migration: Zaplink - Tipo de formulário (consultor/influenciador) + Instagram
-- Data: 2026-03-03
-- Descrição: Adiciona form_type em zaplink_forms e instagram_handle em zaplink_form_submissions.
--            Tipo consultor: nome, email, telefone.
--            Tipo influenciador: + campo @ Instagram.
-- =====================================================

-- Tipo do formulário: consultor | influenciador
ALTER TABLE zaplink_forms
  ADD COLUMN IF NOT EXISTS form_type text NOT NULL DEFAULT 'consultor'
  CHECK (form_type IN ('consultor', 'influenciador'));

-- Instagram @ (apenas para tipo influenciador)
ALTER TABLE zaplink_form_submissions
  ADD COLUMN IF NOT EXISTS instagram_handle text NULL;

COMMENT ON COLUMN zaplink_forms.form_type IS 'Tipo: consultor (nome, email, telefone) ou influenciador (+ instagram @)';
COMMENT ON COLUMN zaplink_form_submissions.instagram_handle IS '@ do Instagram; usado quando form_type do formulário é influenciador';
