-- Contas de anúncio marcadas como BLOQUEADAS pelo gestor (não usadas no sync/spend).
-- Guarda os act_ ids separados por vírgula, subconjunto de ad_account_id.
-- Uso: quando a Meta bloqueia uma conta, o gestor marca aqui e adiciona uma conta de
-- contingência em ad_account_id; a bloqueada continua registrada mas é ignorada.

ALTER TABLE meta_integration_configs
  ADD COLUMN IF NOT EXISTS blocked_ad_account_ids TEXT;

COMMENT ON COLUMN meta_integration_configs.blocked_ad_account_ids IS
  'Contas de anúncio bloqueadas (act_ ids, separados por vírgula) — ignoradas no sync/spend.';

-- Legado (compat): mesma coluna na tabela antiga, se existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='meta_integrations') THEN
    ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS blocked_ad_account_ids TEXT;
  END IF;
END $$;
