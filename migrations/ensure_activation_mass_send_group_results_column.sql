-- Correção: RPC increment_mass_send_job_counts referencia group_results.
-- Se você aplicou add_activation_mass_send_job_groups.sql sem add_activation_mass_send_group_results.sql,
-- o worker falha com: column "group_results" does not exist.
-- Este script é idempotente — pode rodar no SQL Editor do Supabase a qualquer momento.

ALTER TABLE activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS group_results jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN activation_mass_send_jobs.group_results IS
  'Array JSON: [{ "groupId": "...", "success": true|false, "error": "..." }] acumulado por lote';
