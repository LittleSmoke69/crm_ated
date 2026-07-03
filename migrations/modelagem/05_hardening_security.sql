-- =====================================================
-- MODELAGEM 05 — HARDENING DE SEGURANÇA
-- Corrige as brechas dos objetos criados em 02/03/04:
--   A) SECURITY DEFINER sem search_path fixo  (search_path hijacking)
--   B) RPCs SECURITY DEFINER executáveis por PUBLIC (IDOR / escalonamento):
--      recebem o "ator" por parâmetro e ignoram auth.uid(); só devem rodar via service_role.
--   C) Política de INSERT permissiva no histórico do Kanban (spoofing de métrica)
--   D) Views rodando como owner (bypass de RLS → vazam métricas/financeiro)
-- Idempotente. NÃO recria o banco. Rode DEPOIS de 02/03/04.
-- =====================================================

-- A) Fixar search_path das funções SECURITY DEFINER --------------------------
ALTER FUNCTION crm_move_lead(text, uuid, text, integer, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION chat_claim_next_official(uuid, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION chat_mark_first_response(uuid, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION chat_resolve_conversation(uuid, uuid)
  SET search_path = public, pg_temp;

-- B) Tirar EXECUTE de PUBLIC/anon/authenticated. -----------------------------
--    Estes RPCs bypassam RLS e confiam no user_id/agent passado por parâmetro;
--    devem ser chamados APENAS pelo backend (supabaseServiceRole).
--    Se um dia forem chamados pelo client anon/auth, adicione checagem de
--    auth.uid() = ator dentro de cada função ANTES de reabrir o EXECUTE.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'crm_move_lead(text, uuid, text, integer, uuid)',
    'chat_claim_next_official(uuid, uuid)',
    'chat_mark_first_response(uuid, uuid)',
    'chat_resolve_conversation(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    -- anon/authenticated podem não existir em todos os ambientes; ignore erro.
    BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn); EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn); EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END $$;

-- C) Fechar INSERT direto no histórico do Kanban. ----------------------------
--    A escrita ocorre via crm_move_lead (SECURITY DEFINER), que ignora RLS.
--    A política "WITH CHECK (true)" permitia qualquer usuário forjar histórico.
DROP POLICY IF EXISTS crm_lead_stage_history_insert ON crm_lead_stage_history;

-- D) Views respeitando RLS do invocador (não do owner). ----------------------
--    Sem isto (PG15+), qualquer um que consiga SELECT na view vê métricas de
--    TODOS os atendentes / gasto e receita de ADS, ignorando a RLS das tabelas base.
ALTER VIEW chat_attendance_metrics_daily SET (security_invoker = true);
ALTER VIEW meta_campaign_roi_daily       SET (security_invoker = true);

-- Observação: com security_invoker, para um admin ver TODAS as linhas, as
-- tabelas base (chat_conversations, meta_insights_daily, crm_leads) precisam ter
-- política de leitura para admin/super_admin — ou consuma as views via service_role.

-- E) (Opcional) restringir leitura do catálogo de colunas a autenticados. -----
DROP POLICY IF EXISTS crm_columns_read ON crm_columns;
CREATE POLICY crm_columns_read ON crm_columns
  FOR SELECT TO authenticated USING (true);
