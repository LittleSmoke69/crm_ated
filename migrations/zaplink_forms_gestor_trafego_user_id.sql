-- =====================================================
-- Migration: Zaplink - Formulário atribuído ao gestor de tráfego
-- Data: 2026-03-04
-- Descrição: Adiciona gestor_trafego_user_id em zaplink_forms.
--            Quando preenchido, o formulário (e seus leads) é visível apenas para esse gestor no Zaplink.
--            Admin pode "transferir" formulário + leads para um gestor preenchendo este campo.
-- =====================================================

ALTER TABLE zaplink_forms
  ADD COLUMN IF NOT EXISTS gestor_trafego_user_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_zaplink_forms_gestor_trafego ON zaplink_forms(gestor_trafego_user_id) WHERE gestor_trafego_user_id IS NOT NULL;

COMMENT ON COLUMN zaplink_forms.gestor_trafego_user_id IS 'Quando preenchido, o formulário pertence ao gestor de tráfego; ele vê apenas seus formulários e os leads deles no Zaplink.';
