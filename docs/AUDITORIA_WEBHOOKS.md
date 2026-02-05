# Auditoria do Sistema de Webhooks - Parte A

**Data:** 2024  
**Status:** ✅ Concluído

## Resumo

Documentação do fluxo atual de webhooks e eventos no sistema Zaploto, mapeando desde o recebimento dos eventos até a visualização na UI.

---

## Fluxo Atual: Request → Persistência → Listagem → Modal Payload

### 1. Endpoints de Webhook

**Endpoints existentes:**

- `POST /api/webhooks/evolution/prod` - Recebe eventos de produção
- `POST /api/webhooks/evolution/test` - Recebe eventos de teste
- `GET /api/webhooks/evolution/prod` - Healthcheck PROD
- `GET /api/webhooks/evolution/test` - Healthcheck TEST

**Arquivos:**
- `zaplotoapp/app/api/webhooks/evolution/prod/route.ts`
- `zaplotoapp/app/api/webhooks/evolution/test/route.ts`

**Comportamento:**
1. Recebe payload JSON da Evolution API
2. Extrai metadados: `event_type`, `instance_name`, `remote_jid`, `message_id`
3. Salva na tabela `evolution_webhook_events` com campo `payload` (jsonb) contendo o payload completo
4. Retorna 200 imediatamente (não bloqueia a Evolution API)

---

### 2. Tabela de Persistência

**Tabela:** `evolution_webhook_events`

**Estrutura:**
```sql
CREATE TABLE evolution_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  env text NOT NULL CHECK (env IN ('prod', 'test')),
  event_type text NOT NULL,
  instance_name text,
  remote_jid text,
  message_id text,
  payload jsonb NOT NULL
);
```

**Índices:**
- `idx_evolution_webhook_events_received_at` (received_at DESC)
- `idx_evolution_webhook_events_event_type` (event_type)
- `idx_evolution_webhook_events_instance_name` (instance_name)
- `idx_evolution_webhook_events_env` (env)
- `idx_evolution_webhook_events_instance_message_unique` (instance_name, message_id) UNIQUE

**Arquivo de migration:**
- `zaplotoapp/migrations/create_evolution_webhook_tables.sql`

---

### 3. API de Listagem de Eventos

**Endpoint:** `GET /api/admin/webhooks/evolution/events`

**Arquivo:**
- `zaplotoapp/app/api/admin/webhooks/evolution/events/route.ts`

**Query params:**
- `env`: 'prod' | 'test' (opcional)
- `event_type`: tipo do evento (opcional)
- `q`: busca por instance_name, remote_jid ou message_id (opcional)
- `page`: número da página (padrão: 1)
- `limit`: itens por página (padrão: 25, máximo: 100)

**Retorno:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 100,
    "totalPages": 4,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 4. UI de Listagem e Visualização

**Página:** `/admin/webhooks/evolution`

**Arquivo:**
- `zaplotoapp/app/admin/webhooks/evolution/page.tsx`

**Funcionalidades:**
1. Status dos webhooks (último evento recebido)
2. Teste estilo n8n (waiters)
3. Controle de eventos (habilitar/desabilitar tipos)
4. Listagem de eventos com filtros:
   - Ambiente (prod/test/todos)
   - Tipo de evento
   - Busca por instância/JID/Message ID
5. Paginação (25 itens por página)
6. Botão "Ver payload" que abre modal

**Modal "Ver payload" (antes da melhoria):**
- Exibia JSON bruto formatado em `<pre>`
- Botão para copiar JSON completo
- Não tinha navegação por árvore, busca ou cópia de path

---

## Fluxo Completo (atual)

```
1. Evolution API → POST /api/webhooks/evolution/prod
   └─> Extrai metadados do payload
   └─> Salva em evolution_webhook_events (payload jsonb)

2. Admin acessa /admin/webhooks/evolution
   └─> GET /api/admin/webhooks/evolution/events
   └─> Exibe lista de eventos

3. Admin clica em "Ver payload"
   └─> Modal abre com JSON formatado
   └─> Botão copiar JSON completo
```

---

## Melhorias Implementadas (Parte B)

**Componente:** `PayloadViewer`

**Arquivo:**
- `zaplotoapp/components/Webhooks/PayloadViewer.tsx`

**Funcionalidades:**
1. **Abas:**
   - Tree (visualização em árvore com expand/collapse)
   - JSON (pretty print com syntax highlighting)
   - Table (para arrays de objetos)

2. **Busca:**
   - Filtra por chaves, valores e paths
   - Busca recursiva nos filhos

3. **Copy Path:**
   - Botão ao clicar em qualquer nó
   - Gera path no formato n8n: `{{$json.body.data.id}}`
   - Feedback visual ao copiar

4. **Controles:**
   - Expandir/recolher tudo (na view Tree)
   - Seletor de source (input/normalized) - quando houver payload normalizado

5. **Visualização:**
   - Cores por tipo de dado (string=verde, number=roxo, boolean=laranja)
   - Suporte a arrays e objetos aninhados
   - Virtualização implícita (lazy expand na Tree)

---

## Notas Técnicas

### Normalização de Metadados

Os webhooks extraem metadados de diferentes estruturas do payload:

```typescript
eventType = payload?.event || payload?.type || payload?.data?.event || 'unknown';
instanceName = payload?.instance?.instanceName || payload?.instanceName || payload?.instance || null;
messageId = payload?.data?.key?.id || payload?.data?.message?.key?.id || payload?.key?.id || payload?.id || null;
remoteJid = payload?.data?.key?.remoteJid || payload?.data?.message?.key?.remoteJid || payload?.key?.remoteJid || payload?.remoteJid || null;
```

### Multi-tenant

- A tabela `evolution_webhook_events` **não possui** campo `user_id` ou `tenant_id` atualmente
- Todos os eventos são compartilhados (admin pode ver todos)
- **Nota:** Para o Flow Builder, será necessário adicionar `user_id` ou `tenant_id` na tabela de flows

### Segurança

- Webhooks não bloqueiam a Evolution API (sempre retornam 200)
- Erros são logados mas não impedem o retorno
- Índice UNIQUE previne duplicação de eventos (instance_name + message_id)

---

## Próximos Passos

1. ✅ **Parte A - Auditoria**: Concluída
2. ✅ **Parte B - Payload Viewer**: Concluída
3. ⏳ **Parte C - Normalização group-participants.update**: Pendente
4. ⏳ **Parte D - Flow Builder MVP**: Pendente
5. ⏳ **Parte E - Executions + Logs**: Pendente
6. ⏳ **Parte F - Integração Gemini**: Pendente
7. ⏳ **Parte G - Personas/Tons**: Pendente
8. ⏳ **Parte H - Template Boas-vindas**: Pendente

---

**Desenvolvido para o Zaploto** 🚀

