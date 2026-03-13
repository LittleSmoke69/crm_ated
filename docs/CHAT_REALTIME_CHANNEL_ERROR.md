# Chat — Realtime CHANNEL_ERROR (publication e RLS)

Quando o canal de Realtime em `chat_messages` retorna **CHANNEL_ERROR**, o Supabase não consegue inscrever nas mudanças da tabela. Causas comuns e como corrigir.

## Checklist

1. **Publication**  
   As tabelas `chat_messages` e `chat_conversations` precisam estar na publication `supabase_realtime`.

2. **RLS**  
   Com RLS ativo em `chat_messages`/`chat_conversations`, o Realtime usa o JWT do cliente para filtrar linhas. Se não houver política de `SELECT` para o role (anon/authenticated), o canal falha. No projeto, o chat é acessado via API com service role; para o Realtime no browser usamos **RLS desabilitado** nessas tabelas.

3. **REPLICA IDENTITY**  
   Para eventos UPDATE/DELETE enviarem a linha completa, as tabelas devem usar `REPLICA IDENTITY FULL`.

## Como corrigir

Execute no **SQL Editor do Supabase** a migration:

- `migrations/fix_chat_realtime_publication_and_replica.sql`

Ela faz (idempotente):

- Adiciona `chat_conversations` e `chat_messages` à publication `supabase_realtime`
- Define `REPLICA IDENTITY FULL` nas duas tabelas
- Desabilita RLS nelas (evita CHANNEL_ERROR por falta de política)

## Conferir no banco

```sql
-- Tabelas na publication
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- Replica identity
SELECT c.relname, c.relreplident
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('chat_messages', 'chat_conversations');
-- relreplident: 'd' = default, 'f' = full
```

Referência: [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
