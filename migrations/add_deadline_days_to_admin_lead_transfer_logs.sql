-- Migration: Prazo em dias por transferência (admin_lead_transfer_logs)
-- Prazo de expiração do pacote selecionado pelo usuário no passo Destino (padrão 10 dias).

ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS deadline_days INTEGER NOT NULL DEFAULT 10;

COMMENT ON COLUMN admin_lead_transfer_logs.deadline_days IS 'Prazo em dias para expiração deste pacote de leads; definido pelo usuário na transferência (padrão 10).';
