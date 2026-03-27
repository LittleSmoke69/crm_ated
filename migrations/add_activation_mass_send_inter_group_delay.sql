-- Pausa opcional entre um disparo e outro (campanhas de ativação em massa), configurável na UI (0–15s).

ALTER TABLE activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS inter_group_delay_ms integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN activation_mass_send_jobs.inter_group_delay_ms IS
  'Espera em ms entre envios consecutivos (0 = padrão rápido, paralelo por lote). Máx. 15000 na API.';
