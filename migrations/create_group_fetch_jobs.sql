-- =====================================================
-- Migration: Jobs de busca de grupos (Evolution fetchAllGroups)
-- Evita timeout de funções síncronas no Netlify (~10–26s).
-- O processamento roda em Background Function (até ~15 min) ou cron de fallback.
-- =====================================================

CREATE TABLE IF NOT EXISTS group_fetch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  total_groups INT,
  inserted_count INT,
  updated_count INT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_fetch_jobs_user_created
  ON group_fetch_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_fetch_jobs_pending
  ON group_fetch_jobs (created_at ASC)
  WHERE status = 'pending';

COMMENT ON TABLE group_fetch_jobs IS 'Fila de sync fetchAllGroups Evolution; resultado final em whatsapp_groups';
