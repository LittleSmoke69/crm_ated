# Análise do Chat Interno — Conversas não aparecem em tempo real

**Data:** 06/03/2025  
**Objetivo:** Documentar a estrutura atual do chat interno e diagnosticar por que as conversas não são exibidas quando chega um evento de mensagem.

---

## 1. Visão geral da arquitetura

O chat interno funciona em três camadas:

1. **Webhooks** (Evolution API e WhatsApp Oficial) → recebem eventos e gravam no Supabase  
2. **APIs REST** → carregam conversas e mensagens  
3. **Supabase Realtime** → `postgres_changes` para atualizar a UI sem refresh  

Fluxo esperado quando uma mensagem chega:

```
WhatsApp → Webhook (/api/webhooks/evolution ou whatsapp-official)
    → chatService.upsertConversation() + chatService.saveMessage()
    → INSERT/UPDATE em chat_messages
    → Supabase Realtime emite postgres_changes
    → Frontend (page.tsx) recebe e atualiza setMessages()
```

---

## 2. Fluxo de dados

### 2.1 Recepção de mensagens (webhooks)

**Evolution** (`app/api/webhooks/evolution/route.ts`):

- Eventos tratados: `MESSAGES_UPSERT`, `SEND_MESSAGE`, `MESSAGES_UPDATE`, `MESSAGES_DELETE`
- Cria/atualiza `chat_conversations` e grava em `chat_messages`
- Usa `chatService.saveMessage()` com upsert em `conversation_id, message_id`

**WhatsApp Oficial** (`app/api/webhooks/whatsapp-official/route.ts`):

- Processa `messages` e `statuses`
- Também usa `chatService.upsertConversation()` e `chatService.saveMessage()`

### 2.2 Persistência (chat-service)

`lib/services/chat-service.ts`:

- `saveMessage()`: upsert em `chat_messages` com `onConflict: 'conversation_id,message_id'`
- `upsertConversation()`: cria/atualiza conversa por canal (Evolution ou WhatsApp Oficial)

### 2.3 Frontend — carregamento inicial

`app/chat/page.tsx`:

- Carrega conversas: `/api/chat/conversations?instance_id=...` (ou `whatsapp_config_id=...`)
- Carrega mensagens: `/api/chat/messages?conversation_id=...&limit=100`
- Dois canais Realtime para atualizações em tempo real (linhas 222–252 e 264–322)

---

## 3. Causas prováveis do problema

### 3.1 Realtime não habilitado para as tabelas (crítico)

Nas migrations, o Realtime está **comentado**:

```sql
-- create_chat_tables.sql (linhas 59-62)
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
```

Se essas tabelas **não** estiverem na publication `supabase_realtime`, **nenhum** evento é emitido e o frontend nunca recebe `postgres_changes` ao inserir/atualizar mensagens.

**Ação:** Verificar no painel do Supabase (Database → Realtime) se `chat_conversations` e `chat_messages` estão habilitadas.

### 3.2 RLS e chave anon

O Realtime usa o cliente Supabase com `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Se houver RLS em `chat_messages` e a role `anon` não tiver permissão de `SELECT` nas linhas da conversa, o Realtime pode filtrar os eventos e o cliente não os recebe.

**Ação:** Verificar se existe RLS em `chat_messages` e `chat_conversations` e quais políticas se aplicam.

### 3.3 Formato dos dados do Realtime

O handler Realtime espera `payload.new` com a estrutura de `Message`. A interface usa `timestamp` como número (Unix). No banco, `timestamp` é `BIGINT`; se vier como string no JSON, o cálculo `msg.timestamp * 1000` pode falhar.

**Ação:** Garantir normalização de `timestamp` ao processar o payload (ex.: `parseInt` se for string).

### 3.4 Canal Evolution vs WhatsApp Oficial

O Realtime de conversas filtra por `instance_id` (Evolution) ou `whatsapp_config_id` (Oficial). Se o canal selecionado no front for outro, o filtro não bate e a conversa não é atualizada na lista.

**Ação:** Garantir que o canal selecionado na UI corresponda ao canal em que a mensagem foi recebida.

### 3.5 Ordenação e duplicação

No INSERT, o front faz `setMessages((prev) => [...prev, payload.new])`. Não há checagem de `msg.id` antes de inserir; em cenários de evento duplicado, a mesma mensagem pode aparecer duas vezes. A ordenação depende da API inicial; novas mensagens vão para o final.

**Ação:** Opcional: checar se `payload.new.id` já existe antes de adicionar; manter ordenação por `created_at` ou `timestamp`.

### 3.6 Webhook público (ambiente)

O `CHAT_STATUS.md` cita que o chat depende de ambiente público para receber webhooks. Em localhost, sem túnel (ngrok, etc.) ou deploy, os eventos não chegam, então nada é gravado em `chat_messages` e o Realtime nem entra em cena.

**Ação:** Em dev, usar ngrok (ou similar) e configurar a URL na Evolution/Meta; em produção, garantir URL pública do webhook.

---

## 4. Resumo do fluxo atual

| Etapa | Componente | Situação |
|-------|------------|----------|
| 1 | Webhook recebe evento | ✅ Ok (Evolution + WA Oficial) |
| 2 | `chatService.saveMessage()` grava no banco | ✅ Ok |
| 3 | Tabelas na publication `supabase_realtime` | ⚠️ Provavelmente não configurado |
| 4 | Cliente Realtime em `page.tsx` | ✅ Ok (assinatura correta) |
| 5 | RLS em `chat_messages` | ⚠️ Verificar no Supabase |

---

## 5. Ações recomendadas (ordem de prioridade)

### 5.1 Habilitar Realtime para as tabelas

Executar no SQL Editor do Supabase:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
```

(Se já estiverem na publication, o comando pode retornar erro; nesse caso, confirmar no painel.)

### 5.2 Verificar RLS

- No Supabase: Database → Tables → `chat_messages` / `chat_conversations` → RLS.
- Se RLS estiver ativo: criar políticas que permitam `SELECT` para quem deve ver as mensagens, ou desabilitar RLS nessas tabelas conforme política de segurança do projeto.

### 5.3 Garantir ambiente público para webhooks

- Produção: URL pública do webhook configurada.
- Local: ngrok (ou similar) e configurar a URL na Evolution API / Meta.

### 5.4 Adicionar logs no frontend

Para validar se o Realtime está chegando:

```typescript
// Dentro do callback do postgres_changes (chat_messages)
(payload) => {
  console.log('[Realtime chat_messages]', payload.eventType, payload);
  // ... resto do handler
}
```

Se nada aparecer no console, o problema é publicação/RLS. Se aparecer, revisar formato de `payload.new`.

### 5.5 Normalizar timestamp ao inserir no estado

Se `timestamp` vier como string:

```typescript
if (payload.eventType === 'INSERT') {
  const msg = payload.new as Message;
  if (typeof msg.timestamp === 'string') {
    msg.timestamp = parseInt(msg.timestamp, 10);
  }
  setMessages((prev) => [...prev, msg]);
}
```

---

## 6. Checklist de diagnóstico

- [ ] `chat_conversations` e `chat_messages` estão na publication `supabase_realtime`?
- [ ] RLS em `chat_messages`/`chat_conversations` está bloqueando o anon?
- [ ] Webhook está configurado e acessível publicamente?
- [ ] Instâncias Evolution estão com `is_chat_instance = true`?
- [ ] Logs do Realtime mostram algum payload?
- [ ] A API `/api/chat/messages` retorna mensagens corretas ao abrir a conversa?

---

## 7. Referências no código

| Arquivo | Responsabilidade |
|---------|------------------|
| `app/chat/page.tsx` | UI do chat, carregamento inicial, assinatura Realtime (mensagens e conversas) |
| `lib/services/chat-service.ts` | `upsertConversation`, `saveMessage` |
| `app/api/webhooks/evolution/route.ts` | Eventos Evolution → conversa + mensagem |
| `app/api/webhooks/whatsapp-official/route.ts` | Eventos WhatsApp Oficial → conversa + mensagem |
| `app/api/chat/conversations/route.ts` | GET conversas por canal |
| `app/api/chat/messages/route.ts` | GET mensagens por conversa |
| `migrations/create_chat_tables.sql` | Criação das tabelas; Realtime comentado |
| `migrations/add_whatsapp_official_chat_support.sql` | Suporte WhatsApp Oficial em conversas e mensagens |

---

## 8. Documentos relacionados

- `CHAT_STATUS.md` — Status geral do chat e como reativar
- `docs/` — Demais documentação do sistema
