-- Permite pausar campanha de disparo em massa (retoma com status pending).

ALTER TABLE activation_mass_send_jobs
  DROP CONSTRAINT IF EXISTS activation_mass_send_jobs_status_check;

ALTER TABLE activation_mass_send_jobs
  ADD CONSTRAINT activation_mass_send_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'paused', 'completed', 'failed', 'canceled'));
