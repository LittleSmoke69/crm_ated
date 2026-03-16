-- Visitas à página /r/[slug] com parâmetros UTM (para exibir no admin)
CREATE TABLE IF NOT EXISTS redirect_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  redirect_slug_id uuid NOT NULL REFERENCES redirect_slugs(id) ON DELETE CASCADE,
  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_content text NULL,
  utm_term text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redirect_visits_project ON redirect_visits(project_id);
CREATE INDEX IF NOT EXISTS idx_redirect_visits_created ON redirect_visits(created_at DESC);

ALTER TABLE redirect_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "redirect_visits_no_anon" ON redirect_visits FOR ALL USING (false);

COMMENT ON TABLE redirect_visits IS 'Acessos à página /r/[slug] com UTM na URL; exibido no admin/redirect/[slug].';
