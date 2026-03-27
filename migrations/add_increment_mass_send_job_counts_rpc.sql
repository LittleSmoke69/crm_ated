-- Função RPC para incremento atômico dos contadores de mass-send jobs.
-- Evita race condition de read-modify-write quando dois workers processam o mesmo job.
CREATE OR REPLACE FUNCTION increment_mass_send_job_counts(
  p_job_id       UUID,
  p_sent         INT,
  p_failed       INT,
  p_processed_index INT,
  p_last_error   TEXT,
  p_status       TEXT,
  p_now          TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE activation_mass_send_jobs
  SET
    sent_count       = sent_count + p_sent,
    failed_count     = failed_count + p_failed,
    processed_index  = p_processed_index,
    last_error       = p_last_error,
    status           = p_status,
    locked_at        = NULL,
    locked_by        = NULL,
    updated_at       = p_now
  WHERE id = p_job_id;
END;
$$;
