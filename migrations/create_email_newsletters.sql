-- =====================================================
-- Migration: Newsletters (e-mail marketing)
-- Descrição: campanhas de e-mail criadas no admin (aba E-mails), com status,
--            progresso de envio e agendamento.
-- =====================================================

CREATE TABLE IF NOT EXISTS email_newsletters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',          -- 'all' (todos os usuários) | 'custom' (lista colada/importada)
  custom_emails TEXT,                            -- lista de e-mails (separados por vírgula/linha/;) quando audience='custom'
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | scheduled | sending | paused | sent | failed
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  smtp_account_ids UUID[],                       -- contas de envio permitidas para esta campanha; NULL = todas as ativas
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_newsletters_created_at ON email_newsletters(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_newsletters_scheduled ON email_newsletters(scheduled_at) WHERE status = 'scheduled';

COMMENT ON TABLE email_newsletters IS 'Campanhas de e-mail (newsletter) enviadas pelo admin; status: draft | scheduled | sending | paused | sent | failed.';
COMMENT ON COLUMN email_newsletters.smtp_account_ids IS 'Contas SMTP que esta campanha pode usar; NULL = todas as contas ativas (rotação automática).';
