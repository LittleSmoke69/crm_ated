-- =====================================================
-- Migration: Campanhas de disparo em massa (ativações)
-- Data: 2026-03-04
-- Descrição: Jobs em background para envio a muitos grupos sem timeout na Netlify.
--            Quando há muitos grupos (>10), o envio é enfileirado e processado em segundo plano.
-- =====================================================

CREATE TABLE IF NOT EXISTS activation_mass_send_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  message_title text,
  group_ids jsonb NOT NULL DEFAULT '[]',  -- array de group_id (jids)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'canceled')),
  total_groups int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  processed_index int NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_status ON activation_mass_send_jobs(status);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_user ON activation_mass_send_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_created ON activation_mass_send_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_pending ON activation_mass_send_jobs(status, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE activation_mass_send_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own activation_mass_send_jobs"
  ON activation_mass_send_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activation_mass_send_jobs"
  ON activation_mass_send_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE activation_mass_send_jobs IS 'Jobs de disparo em massa para ativações; processados em background para evitar timeout na Netlify';
