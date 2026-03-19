-- Jobs de busca de grupos em segundo plano (evita timeout Netlify em instâncias com muitos grupos)
CREATE TABLE IF NOT EXISTS group_fetch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  groups_count int,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_fetch_jobs_status ON group_fetch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_group_fetch_jobs_user ON group_fetch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_group_fetch_jobs_pending ON group_fetch_jobs(created_at) WHERE status = 'pending';

ALTER TABLE group_fetch_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own group_fetch_jobs"
  ON group_fetch_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own group_fetch_jobs"
  ON group_fetch_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE group_fetch_jobs IS 'Jobs de busca de grupos da Evolution em segundo plano; processados com timeout longo para evitar corte da Netlify';
