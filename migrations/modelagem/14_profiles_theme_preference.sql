-- =====================================================
-- MODELAGEM 14 — preferência de tema do perfil
-- Necessária para GET /api/user/profile, que seleciona esta coluna.
-- =====================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'light';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_preference_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_theme_preference_check
  CHECK (theme_preference IN ('light', 'dark'));

COMMENT ON COLUMN public.profiles.theme_preference IS
  'Tema da interface do usuário: light ou dark.';

NOTIFY pgrst, 'reload schema';
