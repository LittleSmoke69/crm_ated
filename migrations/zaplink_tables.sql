-- =====================================================
-- Migration: Zaplink - Links rastreáveis + Formulário de cadastro
-- Data: 2026-03-03
-- Descrição: Links que registram cliques; formulário nome/email/telefone; admin atribui banca+gerente;
--            notificação ao gerente e disparo em massa (Evolution sendText).
-- =====================================================

-- Links rastreáveis (qualquer URL de destino)
CREATE TABLE IF NOT EXISTS zaplink_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  target_url text NOT NULL,
  title text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zaplink_links_slug ON zaplink_links(slug);
CREATE INDEX IF NOT EXISTS idx_zaplink_links_active ON zaplink_links(is_active) WHERE is_active = true;

-- Cliques nos links (metrificação)
CREATE TABLE IF NOT EXISTS zaplink_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zaplink_link_id uuid NOT NULL REFERENCES zaplink_links(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_content text NULL,
  utm_term text NULL,
  referer text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_zaplink_clicks_link ON zaplink_clicks(zaplink_link_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_clicks_clicked_at ON zaplink_clicks(clicked_at);

-- Formulários Zaplink (cada um tem um slug para a URL /zl/form/[slug])
CREATE TABLE IF NOT EXISTS zaplink_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zaplink_forms_slug ON zaplink_forms(slug);

-- Inscrições do formulário (pendentes até admin atribuir banca + gerente)
CREATE TABLE IF NOT EXISTS zaplink_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zaplink_form_id uuid NOT NULL REFERENCES zaplink_forms(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned')),
  banca_id uuid NULL REFERENCES crm_bancas(id) ON DELETE SET NULL,
  gerente_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL,
  consultor_user_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_zaplink_submissions_form ON zaplink_form_submissions(zaplink_form_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_submissions_status ON zaplink_form_submissions(status);
CREATE INDEX IF NOT EXISTS idx_zaplink_submissions_gerente ON zaplink_form_submissions(gerente_id);

-- Notificações para o gerente (novo consultor atribuído via Zaplink)
CREATE TABLE IF NOT EXISTS zaplink_gerente_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  zaplink_submission_id uuid NOT NULL REFERENCES zaplink_form_submissions(id) ON DELETE CASCADE,
  seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_zaplink_gerente_notif_submission ON zaplink_gerente_notifications(zaplink_submission_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_gerente_notif_gerente ON zaplink_gerente_notifications(gerente_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_gerente_notif_seen ON zaplink_gerente_notifications(gerente_id, seen_at) WHERE seen_at IS NULL;

-- RLS: backend usa service role; políticas restritivas para anon
ALTER TABLE zaplink_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaplink_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaplink_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaplink_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaplink_gerente_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zaplink_links_no_anon" ON zaplink_links FOR ALL USING (false);
CREATE POLICY "zaplink_clicks_no_anon" ON zaplink_clicks FOR ALL USING (false);
CREATE POLICY "zaplink_forms_no_anon" ON zaplink_forms FOR ALL USING (false);
CREATE POLICY "zaplink_form_submissions_no_anon" ON zaplink_form_submissions FOR ALL USING (false);
CREATE POLICY "zaplink_gerente_notifications_no_anon" ON zaplink_gerente_notifications FOR ALL USING (false);

COMMENT ON TABLE zaplink_links IS 'Links rastreáveis: qualquer URL pode ser encurtada e ter cliques medidos';
COMMENT ON TABLE zaplink_forms IS 'Formulários Zaplink: nome, email, telefone; inscrições ficam pendentes até atribuição';
COMMENT ON TABLE zaplink_form_submissions IS 'Inscrições do formulário; admin atribui banca+gerente e cria consultor';
COMMENT ON TABLE zaplink_gerente_notifications IS 'Avisos ao gerente quando um novo consultor é atribuído via Zaplink';
