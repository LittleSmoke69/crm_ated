-- Múltiplos consultores por instância de atendimento (substitui consultor_user_id único).

ALTER TABLE atendimento_chat_assignments
  ADD COLUMN IF NOT EXISTS consultor_user_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE atendimento_chat_assignments
SET consultor_user_ids = ARRAY[consultor_user_id]::uuid[]
WHERE consultor_user_id IS NOT NULL;

DROP INDEX IF EXISTS idx_atendimento_chat_assignments_consultor;

ALTER TABLE atendimento_chat_assignments
  DROP CONSTRAINT IF EXISTS atendimento_chat_assignments_consultor_user_id_fkey;

ALTER TABLE atendimento_chat_assignments
  DROP COLUMN IF EXISTS consultor_user_id;

CREATE INDEX IF NOT EXISTS idx_atendimento_chat_assignments_consultor_ids
  ON atendimento_chat_assignments USING GIN (consultor_user_ids);

COMMENT ON COLUMN atendimento_chat_assignments.consultor_user_ids IS
  'Consultores com acesso à instância no chat de atendimento (hierarquia do gerente + banca quando crm_banca_id definido).';
