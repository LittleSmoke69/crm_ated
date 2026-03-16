-- Status do redirect na visita com UTM: pending (aguardando), complete (redirecionou), incomplete (saiu sem redirecionar)
ALTER TABLE redirect_visits
  ADD COLUMN IF NOT EXISTS status text NULL;

UPDATE redirect_visits SET status = 'pending' WHERE status IS NULL;
COMMENT ON COLUMN redirect_visits.status IS 'pending | complete | incomplete';
