-- =====================================================
-- Migration: Jobs para sincronização em segundo plano dos nomes de grupos
-- Data: 2026-02-24
-- Descrição: Permite executar a busca e salvamento de nomes em background (evita timeout Netlify).
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_group_names_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  group_jids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
  processed_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_group_names_sync_jobs_status
  ON audit_group_names_sync_jobs(status) WHERE status = 'pending';

COMMENT ON TABLE audit_group_names_sync_jobs IS 'Jobs de sync de nomes de grupos para processamento em segundo plano';
