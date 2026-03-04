-- =====================================================
-- Migration: Zaplink - Rastreamento de cliques no link do formulário
-- Descrição: Cliques em /zl/form/[slug] e cadastros já existem em zaplink_form_submissions;
--            esta tabela registra cada acesso (clique) ao link do formulário.
-- =====================================================

CREATE TABLE IF NOT EXISTS zaplink_form_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zaplink_form_id uuid NOT NULL REFERENCES zaplink_forms(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_content text NULL,
  utm_term text NULL,
  referer text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_zaplink_form_clicks_form ON zaplink_form_clicks(zaplink_form_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_form_clicks_clicked_at ON zaplink_form_clicks(clicked_at);

ALTER TABLE zaplink_form_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zaplink_form_clicks_no_anon" ON zaplink_form_clicks FOR ALL USING (false);

COMMENT ON TABLE zaplink_form_clicks IS 'Cliques no link do formulário (/zl/form/[slug]); cadastros em zaplink_form_submissions';
