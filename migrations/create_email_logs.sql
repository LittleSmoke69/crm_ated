-- =====================================================
-- Migration: Log de envio de e-mails + tracking de abertura/clique
-- Descrição: registra todo e-mail enviado pelo sistema (transacional, newsletter
--            e teste), com sucesso ou falha, e o engajamento (pixel de abertura +
--            links assinados) para acompanhamento no painel admin (aba E-mails).
-- Depende de: profiles, email_newsletters, smtp_accounts.
-- =====================================================

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_key TEXT,                -- ex.: 'welcome' | 'password_reset' | 'newsletter' | NULL (avulso)
  category TEXT NOT NULL DEFAULT 'transactional',  -- 'transactional' | 'newsletter' | 'test'
  status TEXT NOT NULL,             -- 'sent' | 'failed'
  error TEXT,                       -- mensagem de erro quando status='failed'
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  newsletter_id UUID REFERENCES email_newsletters(id) ON DELETE SET NULL,
  smtp_account_id UUID REFERENCES smtp_accounts(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ,
  open_count INTEGER NOT NULL DEFAULT 0,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_clicked_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient);
CREATE INDEX IF NOT EXISTS idx_email_logs_newsletter ON email_logs(newsletter_id) WHERE newsletter_id IS NOT NULL;

COMMENT ON TABLE email_logs IS 'Histórico de e-mails enviados pelo sistema (transacionais, newsletters e testes); exibido no painel admin.';
COMMENT ON COLUMN email_logs.template_key IS 'Chave do template usado (welcome, password_reset, newsletter, ...) ou NULL para envio avulso.';
COMMENT ON COLUMN email_logs.status IS 'sent = SMTP aceitou a mensagem; failed = erro no envio (ver coluna error).';
COMMENT ON COLUMN email_logs.opened_at IS 'Primeira abertura registrada pelo pixel de tracking.';
COMMENT ON COLUMN email_logs.clicked_at IS 'Primeiro clique registrado em link rastreado do e-mail.';
COMMENT ON COLUMN email_logs.newsletter_id IS 'Campanha (email_newsletters) que originou este envio, quando aplicável.';
COMMENT ON COLUMN email_logs.smtp_account_id IS 'Qual conta SMTP enviou (auditoria); nulo se enviado pelo fallback do .env ou a conta foi excluída.';

-- Registro atômico de abertura (chamado pela rota pública do pixel)
CREATE OR REPLACE FUNCTION register_email_open(log_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE email_logs
     SET open_count = open_count + 1,
         opened_at  = COALESCE(opened_at, NOW())
   WHERE id = log_id;
$$;

-- Registro atômico de clique (clique implica abertura)
CREATE OR REPLACE FUNCTION register_email_click(log_id UUID, clicked_url TEXT)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE email_logs
     SET click_count      = click_count + 1,
         clicked_at       = COALESCE(clicked_at, NOW()),
         last_clicked_url = clicked_url,
         open_count       = GREATEST(open_count, 1),
         opened_at        = COALESCE(opened_at, NOW())
   WHERE id = log_id;
$$;

-- Estatísticas agregadas por campanha (aba E-mails do admin)
CREATE OR REPLACE VIEW newsletter_tracking_stats AS
SELECT newsletter_id,
       COUNT(*)::INT                                        AS logged,
       COUNT(*) FILTER (WHERE opened_at  IS NOT NULL)::INT  AS opened,
       COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::INT  AS clicked
  FROM email_logs
 WHERE newsletter_id IS NOT NULL
 GROUP BY newsletter_id;
