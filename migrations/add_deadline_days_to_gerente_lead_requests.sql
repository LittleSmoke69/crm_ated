-- Prazo em dias solicitado pelo gerente para o pacote de leads (conversão).
ALTER TABLE gerente_lead_requests
  ADD COLUMN IF NOT EXISTS deadline_days INTEGER NULL;
COMMENT ON COLUMN gerente_lead_requests.deadline_days IS 'Prazo em dias para conversão dos leads solicitado pelo gerente no modal (ex.: 10, 15, 30).';
