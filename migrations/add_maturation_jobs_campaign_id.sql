-- Agrupa jobs da mesma campanha multi-instância (malha: cada job = um remetente envia o plano completo às demais).

ALTER TABLE maturation_jobs
  ADD COLUMN IF NOT EXISTS campaign_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_maturation_jobs_campaign_created
  ON maturation_jobs (campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN maturation_jobs.campaign_id IS
  'UUID comum a todos os jobs de uma campanha (malha N×(N-1): cada instância envia o plano às outras). NULL = job avulso.';
