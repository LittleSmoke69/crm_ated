-- =====================================================
-- Script de Verificação da Migração
-- Execute este script para verificar se tudo foi criado corretamente
-- =====================================================

-- 1. Verifica se as tabelas existem
SELECT 
  'Tabelas' as tipo,
  table_name as nome,
  CASE WHEN row_security = 'YES' THEN 'RLS Habilitado' ELSE 'RLS Desabilitado' END as rls_status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('campaign_groups', 'campaign_contacts')
ORDER BY table_name;

-- 2. Verifica se as funções existem
SELECT 
  'Funções' as tipo,
  routine_name as nome,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_due_campaign_contacts', 'finalizar_campaign_se_necessario')
ORDER BY routine_name;

-- 3. Verifica índices
SELECT 
  'Índices' as tipo,
  indexname as nome,
  tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('campaign_groups', 'campaign_contacts')
ORDER BY tablename, indexname;

-- 4. Verifica triggers
SELECT 
  'Triggers' as tipo,
  trigger_name as nome,
  event_object_table as tabela
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('campaign_groups', 'campaign_contacts')
ORDER BY event_object_table, trigger_name;

-- 5. Testa a função claim_due_campaign_contacts (deve retornar vazio se não houver jobs)
SELECT 
  'Teste Função' as tipo,
  'claim_due_campaign_contacts' as nome,
  COUNT(*) as jobs_retornados
FROM claim_due_campaign_contacts('test-verification', 10, 3);

-- 6. Verifica permissões das funções
SELECT 
  'Permissões' as tipo,
  routine_name as nome,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_due_campaign_contacts', 'finalizar_campaign_se_necessario')
ORDER BY routine_name, grantee;

