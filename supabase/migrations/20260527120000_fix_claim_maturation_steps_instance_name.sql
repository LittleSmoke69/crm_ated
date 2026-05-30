-- Adiciona instance_name em maturation_steps (snapshot do remetente no momento do step).

ALTER TABLE maturation_steps
  ADD COLUMN IF NOT EXISTS instance_name TEXT NULL;

COMMENT ON COLUMN maturation_steps.instance_name IS
  'Nome da instância Evolution remetente deste step (evolution_instances.instance_name).';
