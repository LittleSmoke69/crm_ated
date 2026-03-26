-- =====================================================
-- Migration: VSL White Label + Redirect + Tracking
-- Data: 2026-02-08
-- Descrição: Módulo VSL por banca/projeto com VTurb, tracking (UTM/Meta), redirect ponderado por %.
-- Acesso admin: gestor, super_admin, admin (gestor filtra por banca_id via user_bancas).
-- =====================================================

-- PROJETOS (banca/tenant) do módulo VSL
CREATE TABLE IF NOT EXISTS vsl_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NULL,
  banca_id uuid NULL REFERENCES crm_bancas(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,

  redirect_timer_seconds int NOT NULL DEFAULT 5,
  logo_path text NULL,

  pixel_id text NULL,
  capi_access_token text NULL,
  meta_graph_base_url text NOT NULL DEFAULT 'https://graph.facebook.com/v23.0',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsl_projects_slug ON vsl_projects(slug);
CREATE INDEX IF NOT EXISTS idx_vsl_projects_banca ON vsl_projects(banca_id);

-- PÁGINAS VSL
CREATE TABLE IF NOT EXISTS vsl_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  cta_text text NOT NULL DEFAULT 'Entrar no grupo',
  redirect_slug text NOT NULL,

  video_type text NOT NULL DEFAULT 'vturb',
  video_player_id text NULL,
  video_script_src text NULL,

  cta_min_watch_percent int NOT NULL DEFAULT 0,
  cta_delay_seconds int NOT NULL DEFAULT 0,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsl_pages_project ON vsl_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_vsl_pages_slug ON vsl_pages(slug);

-- REDIRECTS (slug público)
CREATE TABLE IF NOT EXISTS redirect_slugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redirect_slugs_project ON redirect_slugs(project_id);

-- GRUPOS (linhas do painel)
CREATE TABLE IF NOT EXISTS redirect_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  invite_url text NOT NULL,
  weight_percent int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redirect_groups_project ON redirect_groups(project_id);

-- MAPEAMENTO slug -> grupos
CREATE TABLE IF NOT EXISTS redirect_slug_groups (
  redirect_slug_id uuid NOT NULL REFERENCES redirect_slugs(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES redirect_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (redirect_slug_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_rsg_slug ON redirect_slug_groups(redirect_slug_id);

-- SESSÕES VSL (tracking)
CREATE TABLE IF NOT EXISTS vsl_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES vsl_pages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_content text NULL,
  utm_term text NULL,

  fbclid text NULL,
  fbp text NULL,
  fbc text NULL,

  ip_hash text NULL,
  ua_hash text NULL
);

CREATE INDEX IF NOT EXISTS idx_vsl_sessions_project ON vsl_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_vsl_sessions_page ON vsl_sessions(page_id);

-- EVENTOS (dedupe com event_id)
CREATE TABLE IF NOT EXISTS vsl_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES vsl_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_ts timestamptz NOT NULL DEFAULT now(),
  event_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vsl_events_event_id ON vsl_events(event_id);
CREATE INDEX IF NOT EXISTS idx_vsl_events_session ON vsl_events(session_id);
CREATE INDEX IF NOT EXISTS idx_vsl_events_project ON vsl_events(project_id);

-- CLICKS/REDIRECTS (contagem por grupo)
CREATE TABLE IF NOT EXISTS redirect_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vsl_projects(id) ON DELETE CASCADE,
  redirect_slug_id uuid NOT NULL REFERENCES redirect_slugs(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES redirect_groups(id) ON DELETE CASCADE,
  session_id uuid NULL REFERENCES vsl_sessions(id) ON DELETE SET NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,

  utm_campaign text NULL,
  fbclid text NULL
);

CREATE INDEX IF NOT EXISTS idx_redirect_clicks_group ON redirect_clicks(group_id);
CREATE INDEX IF NOT EXISTS idx_redirect_clicks_slug ON redirect_clicks(redirect_slug_id);
CREATE INDEX IF NOT EXISTS idx_redirect_clicks_project ON redirect_clicks(project_id);

-- RLS: tabelas VSL são acessadas via service role no backend; políticas restritivas para anon
ALTER TABLE vsl_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE vsl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE redirect_slugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE redirect_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE redirect_slug_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE vsl_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vsl_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE redirect_clicks ENABLE ROW LEVEL SECURITY;

-- Acesso público não existe a essas tabelas; backend usa service role
CREATE POLICY "vsl_projects_no_anon" ON vsl_projects FOR ALL USING (false);
CREATE POLICY "vsl_pages_no_anon" ON vsl_pages FOR ALL USING (false);
CREATE POLICY "redirect_slugs_no_anon" ON redirect_slugs FOR ALL USING (false);
CREATE POLICY "redirect_groups_no_anon" ON redirect_groups FOR ALL USING (false);
CREATE POLICY "redirect_slug_groups_no_anon" ON redirect_slug_groups FOR ALL USING (false);
CREATE POLICY "vsl_sessions_no_anon" ON vsl_sessions FOR ALL USING (false);
CREATE POLICY "vsl_events_no_anon" ON vsl_events FOR ALL USING (false);
CREATE POLICY "redirect_clicks_no_anon" ON redirect_clicks FOR ALL USING (false);

COMMENT ON TABLE vsl_projects IS 'Projetos VSL White Label (banca/tenant). Admin: gestor, super_admin, admin.';
COMMENT ON COLUMN vsl_projects.banca_id IS 'Opcional: vincula ao crm_bancas para gestor filtrar por user_bancas';
COMMENT ON COLUMN vsl_projects.capi_access_token IS 'NUNCA expor ao client; apenas server com service role';

-- Bucket brand-assets: aplicar migrations/create_brand_assets_storage_bucket.sql (ou criar no Dashboard)
-- Path: bancas/<project_id>/logo.png
