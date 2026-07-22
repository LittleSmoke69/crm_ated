-- =====================================================
-- GESTÃO DE LEADS CAPTURADOS (tela Admin > CRM > Leads)
-- Lead "pendente" = crm_leads com user_id IS NULL (fora do kanban até ser
-- atribuído a um captador; a atribuição usa a RPC crm_move_lead existente).
-- Idempotente: pode rodar mais de uma vez.
-- =====================================================

-- 1) Colunas de captura/atribuição
ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS capture_status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS gerente_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS zaploto_id UUID NULL REFERENCES zaploto_tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN crm_leads.capture_status IS
  'Status do funil de captura (tela Admin > Leads): pendente | em_contato | convertido | descartado. Independente do status da banca (coluna status) e da coluna do kanban.';
COMMENT ON COLUMN crm_leads.gerente_id IS
  'Gerente responsável pelo lead capturado (pode existir antes da atribuição a um captador).';
COMMENT ON COLUMN crm_leads.source IS
  'Origem da captura: manual | import | kanban | sync | webhook.';
COMMENT ON COLUMN crm_leads.zaploto_id IS
  'Tenant do lead capturado (escopo de leads pendentes, que ainda não têm dono).';

-- 2) Leads pendentes não podem colidir em external_id entre si
--    (o UNIQUE (external_id, user_id) não cobre user_id NULL no Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_external_id_unowned_key
  ON crm_leads (external_id)
  WHERE user_id IS NULL;

-- 3) Índice para busca/duplicados por telefone normalizado (somente dígitos)
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone_digits
  ON crm_leads ((regexp_replace(COALESCE(phone, ''), '\D', '', 'g')));

CREATE INDEX IF NOT EXISTS idx_crm_leads_capture_status ON crm_leads (capture_status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_gerente ON crm_leads (gerente_id);

-- 4) Ao excluir um captador, os leads voltam ao pool (user_id = NULL)
--    em vez de serem apagados em cascata.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
   WHERE tc.table_name = 'crm_leads'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'user_id'
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE crm_leads DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE crm_leads
    ADD CONSTRAINT crm_leads_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;
