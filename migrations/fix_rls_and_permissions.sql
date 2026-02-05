-- =====================================================
-- Fix RLS e Permissões para campaign_groups e campaign_contacts
-- Data: 2024
-- Descrição: Configura RLS e permissões para as novas tabelas
-- =====================================================

-- =====================================================
-- 1. Desabilita RLS nas tabelas (recomendado para worker)
-- O worker usa service_role que já bypassa RLS, mas isso garante
-- que não haverá problemas com funções SQL
-- =====================================================

-- Desabilita RLS em campaign_groups
ALTER TABLE campaign_groups DISABLE ROW LEVEL SECURITY;

-- Desabilita RLS em campaign_contacts  
ALTER TABLE campaign_contacts DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 2. OU: Se preferir manter RLS habilitado, cria políticas
-- (Descomente esta seção se quiser usar RLS)
-- =====================================================

/*
-- Habilita RLS
ALTER TABLE campaign_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_contacts ENABLE ROW LEVEL SECURITY;

-- Política: Service role tem acesso total (bypass)
CREATE POLICY "Service role full access campaign_groups"
  ON campaign_groups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access campaign_contacts"
  ON campaign_contacts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Política: Usuários podem ver apenas seus próprios dados
CREATE POLICY "Users can view own campaign_groups"
  ON campaign_groups
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own campaign_contacts"
  ON campaign_contacts
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);
*/

-- =====================================================
-- 3. Garante que as funções SQL têm permissões corretas
-- =====================================================

-- Garante que a função claim_due_campaign_contacts pode ser executada
-- por service_role e authenticated users
GRANT EXECUTE ON FUNCTION claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO anon;

-- Garante que a função finalizar_campaign_se_necessario pode ser executada
GRANT EXECUTE ON FUNCTION finalizar_campaign_se_necessario(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION finalizar_campaign_se_necessario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION finalizar_campaign_se_necessario(UUID) TO anon;

-- =====================================================
-- 4. Verifica se as funções existem
-- =====================================================

-- Execute esta query para verificar:
/*
SELECT 
  routine_name,
  routine_type,
  data_type as return_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_due_campaign_contacts', 'finalizar_campaign_se_necessario');
*/

-- =====================================================
-- 5. Verifica status do RLS
-- =====================================================

-- Execute esta query para verificar:
/*
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('campaign_groups', 'campaign_contacts');
*/

-- =====================================================
-- 6. Se as funções não existirem, recrie-as
-- =====================================================

-- Se a função claim_due_campaign_contacts não existir, execute:
/*
CREATE OR REPLACE FUNCTION claim_due_campaign_contacts(
  worker_id TEXT,
  batch_limit INTEGER DEFAULT 20,
  lock_ttl_minutes INTEGER DEFAULT 3
)
RETURNS SETOF campaign_contacts
LANGUAGE plpgsql
SECURITY DEFINER  -- IMPORTANTE: Permite executar com permissões do criador
AS $$
DECLARE
  lock_expiry TIMESTAMPTZ;
  claimed_count INTEGER := 0;
BEGIN
  lock_expiry := NOW() - (lock_ttl_minutes || ' minutes')::INTERVAL;
  
  RETURN QUERY
  UPDATE campaign_contacts
  SET 
    status = 'processing',
    locked_at = NOW(),
    locked_by = worker_id,
    attempts = attempts + 1,
    started_at = COALESCE(started_at, NOW()),
    updated_at = NOW()
  WHERE id IN (
    SELECT cc.id
    FROM campaign_contacts cc
    WHERE cc.status IN ('queued', 'retry')
      AND cc.scheduled_at <= NOW()
      AND (cc.locked_at IS NULL OR cc.locked_at < lock_expiry)
    ORDER BY cc.scheduled_at ASC, cc.position ASC
    LIMIT batch_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING campaign_contacts.*;
  
  GET DIAGNOSTICS claimed_count = ROW_COUNT;
  RAISE NOTICE 'Worker % claimed % jobs', worker_id, claimed_count;
END;
$$;
*/

-- =====================================================
-- 7. Atualiza schema cache do Supabase (PostgREST)
-- =====================================================

-- Notifica PostgREST para recarregar o schema
NOTIFY pgrst, 'reload schema';

