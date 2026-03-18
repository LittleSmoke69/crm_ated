-- =====================================================
-- Migration: Tabela de jobs assíncronos de remoção de inválidos Anti-Spam
-- Descrição: Persiste estado e resultado da remoção de números inválidos em background
-- =====================================================

CREATE TABLE IF NOT EXISTS anti_spam_remove_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES anti_spam_configs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result jsonb NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_remove_jobs IS 'Jobs assíncronos de remoção de números inválidos dos grupos Anti-Spam. A remoção roda em background com delay entre cada remoção.';

CREATE INDEX IF NOT EXISTS idx_anti_spam_remove_jobs_config_id ON anti_spam_remove_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_remove_jobs_owner_id ON anti_spam_remove_jobs(owner_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_remove_jobs_status ON anti_spam_remove_jobs(status) WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION set_anti_spam_remove_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_anti_spam_remove_jobs_updated_at ON anti_spam_remove_jobs;
CREATE TRIGGER trigger_anti_spam_remove_jobs_updated_at
  BEFORE UPDATE ON anti_spam_remove_jobs
  FOR EACH ROW EXECUTE PROCEDURE set_anti_spam_remove_jobs_updated_at();
