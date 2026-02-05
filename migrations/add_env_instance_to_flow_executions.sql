-- Adiciona env (prod/test) e instance_name em flow_executions
-- para distinguir execuções e exibir instância/usuário na UI

ALTER TABLE flow_executions
  ADD COLUMN IF NOT EXISTS env text CHECK (env IN ('prod', 'test')),
  ADD COLUMN IF NOT EXISTS instance_name text;

COMMENT ON COLUMN flow_executions.env IS 'Ambiente: prod (webhook) ou test (painel de teste)';
COMMENT ON COLUMN flow_executions.instance_name IS 'Nome da instância Evolution que disparou a execução';

CREATE INDEX IF NOT EXISTS idx_flow_executions_env ON flow_executions(env);
CREATE INDEX IF NOT EXISTS idx_flow_executions_instance_name ON flow_executions(instance_name);
