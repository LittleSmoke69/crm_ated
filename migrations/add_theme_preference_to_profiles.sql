-- =====================================================
-- Migration: Adicionar tema preferido (light/dark) ao perfil
-- Data: 2026-02-23
-- Descrição: Permite que cada usuário escolha entre modo claro (white) e escuro (dark).
-- =====================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'light'
  CHECK (theme_preference IN ('light', 'dark'));

COMMENT ON COLUMN profiles.theme_preference IS 'Tema da interface: light (padrão) ou dark';
