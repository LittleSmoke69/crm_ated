-- =====================================================
-- Limpeza de Lista: list_cleaning_jobs, list_cleaning_items, admin_wpp_connect_config
-- Data: 2025
-- Descrição: Tabelas para feature Limpeza de Lista (dedup + validação WhatsApp via WPP Conect)
-- =====================================================

-- 1) list_cleaning_jobs
CREATE TABLE IF NOT EXISTS list_cleaning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'deduped', 'verifying', 'coffee_pause', 'paused_disconnected', 'done', 'error'
  )),
  total_raw INTEGER NOT NULL DEFAULT 0,
  total_unique INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  validated_count INTEGER NOT NULL DEFAULT 0,
  not_validated_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  last_processed_index INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NULL,
  session_name_used TEXT NULL,
  error_message TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_list_cleaning_jobs_user_id ON list_cleaning_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_list_cleaning_jobs_status ON list_cleaning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_list_cleaning_jobs_next_run_at ON list_cleaning_jobs(next_run_at) WHERE next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_list_cleaning_jobs_created_at ON list_cleaning_jobs(created_at DESC);

-- 2) list_cleaning_items
CREATE TABLE IF NOT EXISTS list_cleaning_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES list_cleaning_jobs(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  is_duplicate BOOLEAN NOT NULL DEFAULT false,
  whatsapp_status TEXT NULL CHECK (whatsapp_status IN ('active', 'inactive', 'unknown')),
  verified_at TIMESTAMPTZ NULL,
  raw_payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_list_cleaning_items_job_id ON list_cleaning_items(job_id);
CREATE INDEX IF NOT EXISTS idx_list_cleaning_items_job_phone ON list_cleaning_items(job_id, phone);
CREATE INDEX IF NOT EXISTS idx_list_cleaning_items_verified ON list_cleaning_items(job_id) WHERE verified_at IS NOT NULL;

-- 3) admin_wpp_connect_config (configuração única por ambiente; uso com service_role)
CREATE TABLE IF NOT EXISTS admin_wpp_connect_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL DEFAULT 'default' UNIQUE,
  base_url TEXT NOT NULL DEFAULT 'http://72.61.46.153:21465',
  session_name TEXT NOT NULL DEFAULT 'validador01',
  bearer_token TEXT NULL,
  secret_key TEXT NULL,
  session_status TEXT NULL CHECK (session_status IN ('QRCODE', 'CONNECTED', 'DISCONNECTED')),
  qr_code_data TEXT NULL,
  url_code TEXT NULL,
  version TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at para list_cleaning_jobs
CREATE OR REPLACE FUNCTION update_list_cleaning_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_list_cleaning_jobs_updated_at ON list_cleaning_jobs;
CREATE TRIGGER trigger_update_list_cleaning_jobs_updated_at
  BEFORE UPDATE ON list_cleaning_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_list_cleaning_jobs_updated_at();

-- RLS
ALTER TABLE list_cleaning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_cleaning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_wpp_connect_config ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access list_cleaning_jobs"
  ON list_cleaning_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access list_cleaning_items"
  ON list_cleaning_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access admin_wpp_connect_config"
  ON admin_wpp_connect_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Usuários autenticados: apenas seus jobs
CREATE POLICY "Users can manage own list_cleaning_jobs"
  ON list_cleaning_jobs FOR ALL TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Items: acesso via job do usuário (via join no backend; policy por job_id exigiria subquery)
CREATE POLICY "Users can view list_cleaning_items via job"
  ON list_cleaning_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM list_cleaning_jobs j
      WHERE j.id = list_cleaning_items.job_id AND j.user_id::text = auth.uid()::text
    )
  );

-- Admin config: apenas admin (backend usa requireAdmin)
CREATE POLICY "Admin only admin_wpp_connect_config"
  ON admin_wpp_connect_config FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.status = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.status = 'admin'
    )
  );
