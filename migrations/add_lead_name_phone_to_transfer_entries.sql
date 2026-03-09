-- =====================================================
-- Adiciona colunas lead_name e lead_phone a admin_lead_transfer_entries
-- Permite exibir dados completos do lead no CRM Transferido
-- mesmo quando o CRM externo não retorna os dados.
-- =====================================================

ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS lead_name TEXT,
  ADD COLUMN IF NOT EXISTS lead_phone TEXT;

COMMENT ON COLUMN admin_lead_transfer_entries.lead_name IS 'Nome do lead no momento da transferência (cache para exibição quando CRM não retorna)';
COMMENT ON COLUMN admin_lead_transfer_entries.lead_phone IS 'Telefone do lead no momento da transferência (cache para exibição quando CRM não retorna)';
