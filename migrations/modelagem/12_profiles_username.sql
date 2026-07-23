-- =====================================================
-- MODELAGEM 12 — username de login
-- Permite autenticação por @usuario sem substituir o e-mail do perfil.
-- Idempotente e compatível com perfis existentes.
-- =====================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Normaliza usernames já preenchidos manualmente.
UPDATE public.profiles
SET username = left(lower(regexp_replace(trim(leading '@' FROM trim(username)), '[^a-zA-Z0-9._-]', '', 'g')), 64)
WHERE username IS NOT NULL
  AND trim(username) <> '';

-- Preenche perfis antigos a partir da parte local do e-mail. Em caso de
-- colisão, acrescenta os oito primeiros caracteres do UUID.
WITH candidates AS (
  SELECT
    id,
    COALESCE(
      NULLIF(left(lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), 64), ''),
      'user_' || substr(id::text, 1, 8)
    ) AS base_username
  FROM public.profiles
  WHERE username IS NULL OR trim(username) = ''
), ranked AS (
  SELECT
    id,
    base_username,
    row_number() OVER (PARTITION BY base_username ORDER BY id) AS position
  FROM candidates
)
UPDATE public.profiles AS p
SET username = CASE
  WHEN ranked.position = 1 THEN ranked.base_username
  ELSE left(ranked.base_username, 54) || '_' || substr(ranked.id::text, 1, 8)
END
FROM ranked
WHERE p.id = ranked.id;

-- Resolve também colisões entre usernames que já existiam antes da migration.
WITH duplicates AS (
  SELECT
    id,
    username,
    row_number() OVER (PARTITION BY lower(username) ORDER BY created_at NULLS LAST, id) AS position
  FROM public.profiles
  WHERE username IS NOT NULL
)
UPDATE public.profiles AS p
SET username = left(duplicates.username, 54) || '_' || substr(duplicates.id::text, 1, 8)
FROM duplicates
WHERE p.id = duplicates.id
  AND duplicates.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
  CHECK (
    username IS NULL
    OR username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  );

COMMENT ON COLUMN public.profiles.username IS
  'Identificador único de login sem @; armazenado em minúsculas.';

NOTIFY pgrst, 'reload schema';
