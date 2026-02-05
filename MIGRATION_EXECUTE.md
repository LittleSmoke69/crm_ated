# ⚠️ AÇÃO NECESSÁRIA: Executar Migração SQL no Supabase

## 🔴 Problema Atual

O erro indica que a função `claim_due_campaign_contacts` não existe no banco de dados:

```
Could not find the function public.claim_due_campaign_contacts(batch_limit, lock_ttl_minutes, worker_id)
```

## ✅ Solução: Executar a Migração

### Passo 1: Acessar Supabase Dashboard

1. Acesse: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em: **SQL Editor** (menu lateral)

### Passo 2: Executar o SQL

1. Clique em **New Query**
2. Copie e cole TODO o conteúdo do arquivo:
   ```
   migrations/create_campaign_queue_tables.sql
   ```
3. Clique em **Run** (ou pressione Ctrl+Enter)

### Passo 3: Verificar se Funcionou

Execute esta query para verificar se as funções foram criadas:

```sql
-- Verifica se a função existe
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_due_campaign_contacts', 'finalizar_campaign_se_necessario');

-- Verifica se as tabelas existem
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('campaign_groups', 'campaign_contacts');
```

Você deve ver:
- ✅ `claim_due_campaign_contacts` (function)
- ✅ `finalizar_campaign_se_necessario` (function)
- ✅ `campaign_groups` (table)
- ✅ `campaign_contacts` (table)

### Passo 4: Atualizar Schema Cache (se necessário)

Se ainda der erro após executar o SQL, pode ser cache do Supabase. Tente:

1. No Supabase Dashboard, vá em **Settings → API**
2. Role até **Schema Cache**
3. Clique em **Clear Cache** ou **Refresh Schema**

Ou execute no SQL Editor:

```sql
-- Força atualização do schema
NOTIFY pgrst, 'reload schema';
```

## 📋 Checklist

- [ ] Executou o SQL completo do arquivo `migrations/create_campaign_queue_tables.sql`
- [ ] Verificou que as funções foram criadas
- [ ] Verificou que as tabelas foram criadas
- [ ] Limpou o cache do schema (se necessário)
- [ ] Testou novamente o worker

## 🧪 Teste Rápido

Após executar a migração, teste se a função funciona:

```sql
-- Teste básico (deve retornar vazio se não houver jobs)
SELECT * FROM claim_due_campaign_contacts(
  'test-worker',
  10,
  3
);
```

Se não der erro, a função está funcionando! ✅

## 🐛 Se Ainda Der Erro

1. Verifique se você tem permissões de administrador no Supabase
2. Verifique se está conectado ao banco correto
3. Verifique os logs do SQL Editor para ver se houve erros na criação
4. Tente executar a função SQL em partes menores

