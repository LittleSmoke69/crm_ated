-- Vincula instância de atendimento a uma banca (CRM) escolhida pelo gerente.
-- Consultores exibidos no chat-atendimento são filtrados por essa banca.

ALTER TABLE atendimento_chat_assignments
  ADD COLUMN IF NOT EXISTS crm_banca_id UUID NULL REFERENCES crm_bancas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atendimento_chat_assignments_crm_banca
  ON atendimento_chat_assignments (crm_banca_id)
  WHERE crm_banca_id IS NOT NULL;

COMMENT ON COLUMN atendimento_chat_assignments.crm_banca_id IS
  'Banca (crm_bancas) à qual o gerente associou esta instância; filtra consultores no atendimento.';
