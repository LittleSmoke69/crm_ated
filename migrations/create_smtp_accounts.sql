-- =====================================================
-- Migration: Contas SMTP para disparo de e-mail (rotação)
-- Descrição: pool de caixas de e-mail para o motor de envio (lib/services/mailer.ts).
--            Cada conta tem um limite diário; o mailer roda em rotação, usando
--            sempre a conta ativa menos utilizada no dia. Sem contas cadastradas,
--            o sistema usa o SMTP único configurado via SMTP_HOST/SMTP_USER/SMTP_PASS no .env.
-- =====================================================

CREATE TABLE IF NOT EXISTS smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                              -- rótulo no admin (ex.: "Hostinger suporte@")
  host TEXT NOT NULL DEFAULT 'smtp.hostinger.com',
  port INTEGER NOT NULL DEFAULT 465,
  username TEXT NOT NULL,                          -- login SMTP real (a caixa)
  password TEXT NOT NULL,
  from_name TEXT,                                  -- nome exibido no remetente
  from_email TEXT NOT NULL,                        -- e-mail do remetente (pode ser alias da caixa)
  daily_limit INTEGER NOT NULL DEFAULT 1000,       -- limite de envios/dia da conta
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sent_today INTEGER NOT NULL DEFAULT 0,           -- envios no dia em sent_date (fuso America/Sao_Paulo)
  sent_date DATE,                                  -- dia a que sent_today se refere
  last_error TEXT,                                 -- último erro de envio desta conta
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE smtp_accounts IS 'Contas SMTP cadastradas no admin para rotação de envio de e-mails (limite diário por conta).';
COMMENT ON COLUMN smtp_accounts.sent_today IS 'Contador de envios do dia sent_date (fuso America/Sao_Paulo); zera quando o dia vira.';

-- Contém senhas em texto plano: RLS ligado sem policies = acesso somente via service role (rotas server-side).
ALTER TABLE smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Incremento atômico do contador diário; concorrência entre cron e API fica segura.
CREATE OR REPLACE FUNCTION increment_smtp_sent(p_account_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE smtp_accounts
     SET sent_today   = CASE WHEN sent_date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
                             THEN sent_today + 1 ELSE 1 END,
         sent_date    = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE,
         last_used_at = NOW(),
         last_error   = NULL,
         updated_at   = NOW()
   WHERE id = p_account_id;
$$;
