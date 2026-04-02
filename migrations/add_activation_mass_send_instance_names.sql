-- Rotação de instâncias no disparo em massa: cada grupo usa instance_names[i % n].
ALTER TABLE public.activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS instance_names JSONB;

COMMENT ON COLUMN public.activation_mass_send_jobs.instance_names IS
  'Array JSON de instance_name para alternar por grupo (índice processed_index). NULL = usar só instance_name.';
