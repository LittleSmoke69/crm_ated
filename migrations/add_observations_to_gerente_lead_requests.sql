-- Observação opcional enviada pelo gerente junto com a solicitação de leads (visível ao admin).
ALTER TABLE gerente_lead_requests
  ADD COLUMN IF NOT EXISTS observations TEXT NULL;
COMMENT ON COLUMN gerente_lead_requests.observations IS 'Observação opcional enviada pelo gerente na solicitação de leads; exibida ao admin na aprovação.';
