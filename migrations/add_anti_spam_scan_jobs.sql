-- =====================================================
-- Migration: Tabela de jobs assíncronos de scan Anti-Spam
-- Descrição: Persiste estado e resultado do scan em background
-- =====================================================

CREATE TABLE IF NOT EXISTS anti_spam_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES anti_spam_configs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result jsonb NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_scan_jobs IS 'Jobs assíncronos de scan de grupos Anti-Spam. O scan roda em background e o cliente consulta o status por polling.';

CREATE INDEX IF NOT EXISTS idx_anti_spam_scan_jobs_config_id ON anti_spam_scan_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_scan_jobs_owner_id ON anti_spam_scan_jobs(owner_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_scan_jobs_status ON anti_spam_scan_jobs(status) WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION set_anti_spam_scan_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_anti_spam_scan_jobs_updated_at ON anti_spam_scan_jobs;
CREATE TRIGGER trigger_anti_spam_scan_jobs_updated_at
  BEFORE UPDATE ON anti_spam_scan_jobs
  FOR EACH ROW EXECUTE PROCEDURE set_anti_spam_scan_jobs_updated_at();
