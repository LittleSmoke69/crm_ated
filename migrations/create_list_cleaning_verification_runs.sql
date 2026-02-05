-- =====================================================
-- Limpeza de Lista: list_cleaning_verification_runs (job_check)
-- Arquitetura em slots: cada execução processa no máximo 10-15 números, ~20s
-- Scheduler continua os slots até concluir; evita timeout no Netlify.
-- =====================================================

CREATE TABLE IF NOT EXISTS list_cleaning_verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES list_cleaning_jobs(id) ON DELETE CASCADE,
  total_numbers INTEGER NOT NULL DEFAULT 0,
  processed_numbers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'error'
  )),
  current_slot INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_list_cleaning_verification_runs_job_id
  ON list_cleaning_verification_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_list_cleaning_verification_runs_status
  ON list_cleaning_verification_runs(status) WHERE status = 'running';

COMMENT ON TABLE list_cleaning_verification_runs IS 'Um run por job; processado em slots pelo scheduler (máx ~10 números/slot, ~20s).';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_list_cleaning_verification_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_list_cleaning_verification_runs_updated_at ON list_cleaning_verification_runs;
CREATE TRIGGER trigger_update_list_cleaning_verification_runs_updated_at
  BEFORE UPDATE ON list_cleaning_verification_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_list_cleaning_verification_runs_updated_at();

ALTER TABLE list_cleaning_verification_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access list_cleaning_verification_runs"
  ON list_cleaning_verification_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users can view own runs via job"
  ON list_cleaning_verification_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM list_cleaning_jobs j
      WHERE j.id = list_cleaning_verification_runs.job_id AND j.user_id::text = auth.uid()::text
    )
  );
