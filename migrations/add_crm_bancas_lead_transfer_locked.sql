-- Bloqueio global de transferência de leads por banca (controlado apenas por super_admin na aplicação).

ALTER TABLE crm_bancas
  ADD COLUMN IF NOT EXISTS lead_transfer_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN crm_bancas.lead_transfer_locked IS
  'Quando true, operações de transferência de leads (admin/gerente) ficam impedidas até desbloqueio pelo super_admin.';
