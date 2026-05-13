-- Mirror de supabase/migrations/20260506140000_add_lead_email_to_admin_lead_transfer_entries.sql (aplicar no mesmo ambiente).

ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS lead_email TEXT;

COMMENT ON COLUMN admin_lead_transfer_entries.lead_email IS
  'E-mail do lead gravado na transferência (snapshot). Usado na busca do histórico por e-mail além do cruzamento com crm_leads.external_id.';

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_lead_email_lower
  ON admin_lead_transfer_entries (lower(trim(lead_email)))
  WHERE lead_email IS NOT NULL AND trim(lead_email) <> '';
