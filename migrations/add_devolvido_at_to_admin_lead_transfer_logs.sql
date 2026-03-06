-- Marca transferências que tiveram os leads devolvidos (botão Devolver no histórico).
ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS devolvido_at TIMESTAMPTZ NULL;
COMMENT ON COLUMN admin_lead_transfer_logs.devolvido_at IS 'Data/hora em que os leads desta transferência foram devolvidos ao consultor de origem (devolução).';
