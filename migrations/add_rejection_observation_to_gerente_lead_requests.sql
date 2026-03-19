-- Observação opcional do admin ao rejeitar uma solicitação de leads (visível ao gerente).
ALTER TABLE gerente_lead_requests
  ADD COLUMN IF NOT EXISTS rejection_observation TEXT NULL;
COMMENT ON COLUMN gerente_lead_requests.rejection_observation IS 'Observação opcional informada pelo admin ao rejeitar a solicitação; exibida ao gerente.';
