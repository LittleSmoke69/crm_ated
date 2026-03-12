# Análise do Chat Interno — Estrutura HTML, Realtime e Banco de Dados

**Data:** 06/03/2025 | **Atualizado:** 12/03/2026  
**Objetivo:** Documentar a estrutura HTML/JSX completa do chat interno, diagnosticar por que as conversas não são exibidas em tempo real, registrar o schema do banco de dados e mapear melhorias estruturais.

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

---

## 9. Estrutura HTML/JSX Completa — `app/chat/page.tsx`

O arquivo possui **968 linhas** e é **completamente monolítico** (`use client`). Toda a UI, estado, lógica de negócio e assinaturas Realtime vivem em um único componente `ChatPage`.

### 9.1 Hierarquia de componentes (árvore HTML)

```
<Layout>                                          ← wrapper global (nav + sidebar do app)
  <div.flex.h-[calc(100vh-80px)]>               ← container principal 3 painéis

    ├── PAINEL ESQUERDO (w-64)                   ← Navegação + seleção de canal
    │   ├── <div.p-4>                            ← Cabeçalho "Zaploto Chat"
    │   │   ├── <h2> "Zaploto Chat"
    │   │   └── <div.space-y-2>                  ← Menu de navegação
    │   │       ├── <button> Minha Caixa          (Inbox icon) — sem ação funcional
    │   │       └── <div.space-y-1>              ← Grupo "Conversas"
    │   │           ├── label "CONVERSAS"
    │   │           ├── <button> Todas (ativo)    (MessageCircle icon) — sem ação funcional
    │   │           ├── <button> Menções          (AlertCircle icon)   — sem ação funcional
    │   │           └── <button> Por responder    (Clock icon)         — sem ação funcional
    │   │
    │   ├── [se canSelectChannel]                ← Seletor de canal (admin/super_admin/suporte)
    │   │   └── <select>                         ← <optgroup> Evolution + WA Oficial
    │   │
    │   ├── [senão, se selectedChannel]          ← Label somente leitura do canal
    │   │   └── <div> nome do canal
    │   │
    │   └── <div.flex-1.overflow-y-auto.p-4>    ← Área livre do painel esq. (vazia atualmente)

    ├── PAINEL CENTRAL (w-80)                    ← Lista de conversas
    │   ├── <div.p-4>                            ← Cabeçalho do painel
    │   │   ├── <span> "Conversas do banco"       (Database icon)
    │   │   ├── <button> Atualizar                (RefreshCw icon) → loadConversationsFromApi()
    │   │   ├── <input type="text">              ← Busca (search)
    │   │   └── <div.flex>                       ← Abas de filtro
    │   │       ├── <button> Minhas (N)          → setConversationFilter('mine')
    │   │       ├── <button> Não atribuídas (N)  → setConversationFilter('unassigned')
    │   │       └── <button> Todas (N)           → setConversationFilter('all')
    │   │
    │   └── <div.flex-1.overflow-y-auto>        ← Scroll da lista
    │       └── [map filteredConversations]
    │           └── <div.p-3>                   ← Card de conversa (onClick → select)
    │               ├── <div> avatar iniciais    (colorido por hash do título)
    │               └── <div.flex-1>
    │                   ├── <h3> título + badge 24h (WA Oficial)
    │                   ├── <span> last_message_at formatado
    │                   ├── <p> last_message_preview (truncado)
    │                   └── <span> unread_count badge (se > 0)

    └── PAINEL DIREITO (flex-1)                 ← Chat ativo
        ├── [se selectedConversationId]
        │   ├── HEADER DA CONVERSA
        │   │   ├── avatar + título + remote_jid
        │   │   ├── badge janela 24h (WA Oficial)
        │   │   ├── <button> Resolver             (CheckCircle2) — abre showResolveMenu
        │   │   └── <button> MoreVertical         — sem ação funcional
        │   │
        │   ├── ÁREA DE MENSAGENS (flex-1 overflow-y-auto)
        │   │   └── [map messages]
        │   │       ├── [separador de data se mudou o dia]
        │   │       └── <div.flex justify-end | justify-start>
        │   │           ├── avatar remetente (se from_me = false)
        │   │           └── <div> balão da mensagem
        │   │               ├── <p> msg.text
        │   │               ├── <p> msg.caption (mídia)
        │   │               └── <div> horário + status icon (from_me)
        │   │       └── <div ref={messagesEndRef} />   ← âncora de scroll
        │   │
        │   └── INPUT DE MENSAGEM
        │       ├── <button> Responder           — sem ação funcional
        │       ├── <button> Nota Privada        — sem ação funcional
        │       ├── <textarea ref={textareaRef}> ← auto-resize, Enter envia
        │       └── <div.flex>                  ← Barra de ações
        │           ├── <button> Smile           — sem ação funcional
        │           ├── <button> Paperclip       — sem ação funcional
        │           ├── <button> Mic             — sem ação funcional
        │           ├── <button> FileText        — sem ação funcional
        │           ├── <button> MessageSquare   — sem ação funcional
        │           ├── <button> Assistente de IA — sem ação funcional
        │           └── <button> Enviar          → handleSendMessage()
        │
        └── [senão] empty state                 ← "Selecione uma conversa"
            └── MessageSquare icon + texto
```

### 9.2 Interfaces TypeScript (dentro de `page.tsx`)

| Interface | Campos |
|-----------|--------|
| `Message` | `id`, `text`, `direction ('in'\|'out')`, `status`, `timestamp (number)`, `created_at`, `from_me`, `media_type?`, `media_url?`, `caption?`, `sender_jid?` |
| `Conversation` | `id`, `remote_jid`, `title`, `last_message_preview`, `last_message_at`, `last_customer_message_at?`, `unread_count`, `is_group`, `user_id?`, `whatsapp_config_id?` |
| `ChannelEvolution` | `type:'evolution'`, `id`, `instance_name`, `status` |
| `ChannelWhatsAppOfficial` | `type:'whatsapp_official'`, `id`, `name`, `phone_number_id` |
| `Channel` | union de `ChannelEvolution \| ChannelWhatsAppOfficial` |
| `ConversationFilter` | `'all' \| 'mine' \| 'unassigned'` |
| `UserStatus` | `'super_admin' \| 'admin' \| 'suporte' \| string \| null` |

### 9.3 Estado (`useState`) em `page.tsx`

| Estado | Tipo | Responsabilidade |
|--------|------|-----------------|
| `userStatus` | `UserStatus` | Controla permissões de seleção de canal e notificações |
| `channels` | `{evolution[], whatsapp_official[]}` | Lista de canais disponíveis |
| `selectedChannel` | `Channel \| null` | Canal ativo |
| `conversations` | `Conversation[]` | Lista de conversas do banco |
| `selectedConversationId` | `string` | ID da conversa aberta |
| `messages` | `Message[]` | Mensagens da conversa ativa |
| `messageText` | `string` | Texto do input de envio |
| `loading` | `boolean` | Indicador de carregamento genérico |
| `sending` | `boolean` | Indicador de envio de mensagem |
| `searchTerm` | `string` | Filtro de busca na lista |
| `conversationFilter` | `ConversationFilter` | Aba ativa (mine/unassigned/all) |
| `showResolveMenu` | `boolean` | Controla menu "Resolver" |

### 9.4 Problemas estruturais identificados na UI

| # | Problema | Localização | Impacto |
|---|----------|-------------|---------|
| P1 | Arquivo monolítico com 968 linhas | `app/chat/page.tsx` | Difícil manutenção e testes |
| P2 | Sem separação de responsabilidades | Toda lógica misturada na page | Impossível reusar lógica ou componentes |
| P3 | `timestamp` tratado como `number * 1000` mas pode chegar como `string` do Realtime | Linhas 824–825, 831 | Datas incorretas em mensagens via Realtime |
| P4 | Sem deduplicação no INSERT do Realtime | Linha 241 | Mensagem duplicada se evento Realtime chegar 2x |
| P5 | Sem skeleton/loading state por conversa | Painel direito | UX ruim ao trocar de conversa |
| P6 | Botões sem ação (Resolver, Notas, Emoji, Clip, Mic, FileText, IA) | Input + header | Funcionalidades prometidas na UI mas não implementadas |
| P7 | `loading` é um estado único para tudo | — | Spinner aparece em locais errados simultaneamente |
| P8 | Sem paginação de mensagens (limite fixo 100) | `loadMessages()` linha 203 | Conversas longas perdem histórico |
| P9 | Sem scroll-to-bottom inteligente | `useEffect` linha 221 | Scroll força descida mesmo se usuário estiver lendo histórico |
| P10 | `authHeaders()` recriado a cada render | Linha 99 | Pequena ineficiência, deveria ser `useMemo` |

---

## 10. Melhorias sugeridas para Realtime

### 10.1 Deduplicação no INSERT

```typescript
// Substituir linha 241 por:
if (payload.eventType === 'INSERT') {
  const msg = payload.new as Message;
  // Normalizar timestamp se vier como string do Realtime
  if (typeof msg.timestamp === 'string') {
    msg.timestamp = parseInt(msg.timestamp, 10);
  }
  setMessages((prev) => {
    if (prev.some((m) => m.id === msg.id)) return prev; // deduplicação
    return [...prev, msg];
  });
}
```

### 10.2 Canal de mensagens com status de conexão

```typescript
const channel = supabase
  .channel(`chat_messages_${selectedConversationId}`)
  .on('postgres_changes', { ... }, handler)
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('[Realtime] conectado');
    if (status === 'CHANNEL_ERROR') console.error('[Realtime] erro no canal');
    if (status === 'TIMED_OUT') console.warn('[Realtime] timeout — reconectando');
  });
```

### 10.3 Scroll inteligente

```typescript
// Só rolar para baixo se o usuário já estava no final
const isAtBottom = messagesEndRef.current
  ? messagesEndRef.current.getBoundingClientRect().bottom <= window.innerHeight + 50
  : true;
if (isAtBottom) {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}
```

### 10.4 Refatoração de componentes sugerida

```
app/chat/
  page.tsx                        ← orquestrador (< 150 linhas)
  hooks/
    useChatChannels.ts            ← carrega canais, selectedChannel
    useChatConversations.ts       ← lista, filtros, realtime conversations
    useChatMessages.ts            ← mensagens, realtime messages, send
  components/
    ChatSidebar.tsx               ← painel esquerdo
    ConversationList.tsx          ← painel central (lista)
    ConversationItem.tsx          ← card de conversa
    ChatWindow.tsx                ← painel direito
    MessageBubble.tsx             ← balão de mensagem
    MessageInput.tsx              ← input de envio
    ChatHeader.tsx                ← header da conversa ativa
```

---

## 11. Schema do Banco de Dados

### 11.1 Tabela `chat_conversations`

Criada em `migrations/create_chat_tables.sql` + estendida por `add_whatsapp_official_chat_support.sql` e `add_chat_conversations_window_24h.sql`.

```sql
CREATE TABLE chat_conversations (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id              UUID,
    user_id                   UUID REFERENCES profiles(id),
    instance_id               UUID REFERENCES evolution_instances(id) ON DELETE CASCADE,
    -- nullable após add_whatsapp_official_chat_support.sql
    whatsapp_config_id        UUID REFERENCES whatsapp_official_configs(id) ON DELETE CASCADE,
    -- adicionado em add_whatsapp_official_chat_support.sql
    remote_jid                TEXT NOT NULL,
    title                     TEXT,
    is_group                  BOOLEAN DEFAULT FALSE,
    last_message_at           TIMESTAMPTZ DEFAULT NOW(),
    last_message_preview      TEXT,
    unread_count              INTEGER DEFAULT 0,
    last_customer_message_at  TIMESTAMPTZ,
    -- adicionado em add_chat_conversations_window_24h.sql
    -- usada para janela de 24h do WA Oficial
    created_at                TIMESTAMPTZ DEFAULT NOW()
);
```

**Constraints e Índices:**

| Nome | Tipo | Definição |
|------|------|-----------|
| `chat_conversations_pkey` | PRIMARY KEY | `id` |
| `idx_chat_conversations_instance_remote` | UNIQUE INDEX parcial | `(instance_id, remote_jid) WHERE instance_id IS NOT NULL` |
| `idx_chat_conversations_whatsapp_config_remote` | UNIQUE INDEX parcial | `(whatsapp_config_id, remote_jid) WHERE whatsapp_config_id IS NOT NULL` |
| `idx_chat_conversations_instance_id` | INDEX | `instance_id` |
| `idx_chat_conversations_workspace_id` | INDEX | `workspace_id` |
| `idx_chat_conversations_last_customer_message_at` | INDEX parcial | `last_customer_message_at DESC WHERE whatsapp_config_id IS NOT NULL` |

**Regra de negócio:** Uma conversa por número de telefone (`remote_jid`) por canal. Novas mensagens do mesmo número são continuadas na mesma conversa.

---

### 11.2 Tabela `chat_messages`

Criada em `migrations/create_chat_tables.sql` + estendida por `add_whatsapp_official_chat_support.sql`.

```sql
CREATE TABLE chat_messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID,
    user_id          UUID REFERENCES profiles(id),
    instance_id      UUID REFERENCES evolution_instances(id) ON DELETE CASCADE,
    -- nullable após add_whatsapp_official_chat_support.sql
    whatsapp_config_id UUID REFERENCES whatsapp_official_configs(id) ON DELETE SET NULL,
    -- adicionado em add_whatsapp_official_chat_support.sql
    conversation_id  UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    message_id       TEXT NOT NULL,
    -- ID externo do WhatsApp (Evolution ou Meta)
    provider         TEXT NOT NULL DEFAULT 'evolution',
    -- 'evolution' | 'whatsapp_official' — adicionado em add_whatsapp_official_chat_support.sql
    direction        TEXT CHECK (direction IN ('in', 'out')),
    from_me          BOOLEAN DEFAULT FALSE,
    sender_jid       TEXT,
    text             TEXT,
    media_type       TEXT,
    -- 'text' | 'image' | 'video' | 'audio' | 'document'
    media_url        TEXT,
    caption          TEXT,
    status           TEXT DEFAULT 'pending',
    -- 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
    timestamp        BIGINT,
    -- Unix timestamp em segundos (cuidado: pode chegar como string no Realtime)
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
```

**Constraints e Índices:**

| Nome | Tipo | Definição |
|------|------|-----------|
| `chat_messages_pkey` | PRIMARY KEY | `id` |
| `idx_chat_messages_conversation_message` | UNIQUE INDEX | `(conversation_id, message_id)` |
| `idx_chat_messages_conversation_id` | INDEX | `conversation_id` |
| `idx_chat_messages_created_at` | INDEX | `created_at DESC` |
| `idx_chat_messages_workspace_id` | INDEX | `workspace_id` |
| `idx_chat_messages_instance_id_remote_jid` | INDEX | `(instance_id, sender_jid)` |
| `idx_chat_messages_message_id_provider` | INDEX parcial | `(message_id, provider) WHERE provider = 'whatsapp_official'` |

---

### 11.3 Extensões em `evolution_instances`

Adicionadas em `create_chat_tables.sql`:

```sql
ALTER TABLE evolution_instances
    ADD COLUMN IF NOT EXISTS workspace_id         UUID,
    ADD COLUMN IF NOT EXISTS webhook_configured   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_chat_instance     BOOLEAN DEFAULT FALSE;
```

`is_chat_instance = true` é o critério para a instância aparecer no seletor de canal do chat.

---

### 11.4 Função RPC

```sql
CREATE OR REPLACE FUNCTION increment_unread_count(conv_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE chat_conversations
    SET unread_count = unread_count + 1
    WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;
```

Usada para incrementar `unread_count` de forma atômica, evitando race conditions.

---

### 11.5 Realtime (⚠️ pendente)

As linhas que habilitam o Realtime estão **comentadas** na migration `create_chat_tables.sql` (linhas 61–62):

```sql
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
```

**Ação obrigatória:** Executar no SQL Editor do Supabase:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
```

---

### 11.6 Diagrama de relacionamentos

```
profiles (id)
    ├──< chat_conversations.user_id
    └──< chat_messages.user_id

evolution_instances (id)
    ├──< chat_conversations.instance_id  (CASCADE DELETE)
    └──< chat_messages.instance_id       (SET NULL após migration oficial)

whatsapp_official_configs (id)
    ├──< chat_conversations.whatsapp_config_id  (CASCADE DELETE)
    └──< chat_messages.whatsapp_config_id       (SET NULL)

chat_conversations (id)
    └──< chat_messages.conversation_id  (CASCADE DELETE)
```

---

## 12. Checklist de diagnóstico atualizado

- [ ] `chat_conversations` e `chat_messages` estão na publication `supabase_realtime`?
- [ ] RLS em `chat_messages` / `chat_conversations` está bloqueando o anon?
- [ ] Webhook está configurado e acessível publicamente?
- [ ] Instâncias Evolution estão com `is_chat_instance = true`?
- [ ] Logs `[Realtime chat_messages]` aparecem no console ao chegar mensagem?
- [ ] A API `/api/chat/messages` retorna mensagens corretas ao abrir a conversa?
- [ ] `timestamp` é normalizado (parseInt) antes de ser exibido no Realtime?
- [ ] Deduplicação de mensagens por `msg.id` implementada no handler INSERT?
- [ ] Canal Supabase tem log de status `SUBSCRIBED` no boot?
- [ ] Arquivo `page.tsx` foi refatorado em componentes menores?
