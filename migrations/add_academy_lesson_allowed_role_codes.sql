-- =====================================================
-- Academy: aulas restritas por cargo (profiles.status)
-- NULL ou {} = todos os cargos (comportamento anterior)
-- =====================================================

ALTER TABLE academy_lessons
  ADD COLUMN IF NOT EXISTS allowed_role_codes TEXT[] NULL;

COMMENT ON COLUMN academy_lessons.allowed_role_codes IS
  'Códigos de cargo (ex.: consultor, gerente). NULL ou array vazio = aula visível para todos.';

CREATE INDEX IF NOT EXISTS idx_academy_lessons_allowed_roles
  ON academy_lessons USING GIN (allowed_role_codes)
  WHERE allowed_role_codes IS NOT NULL AND cardinality(allowed_role_codes) > 0;
