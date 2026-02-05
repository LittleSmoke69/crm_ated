# Status do Chat Interno - Zaploto

**Data:** $(date)  
**Status:** ⏸️ Temporariamente Desabilitado

## 📋 Resumo

O Chat Interno foi implementado mas está **temporariamente desabilitado** porque requer um ambiente público para receber webhooks da Evolution API. Como estamos desenvolvendo em localhost, não é possível receber essas notificações.

## ✅ O que foi Implementado

### 1. Estrutura de Banco de Dados

- ✅ **Tabela `chat_conversations`**: Armazena conversas por instância
  - Campos: `id`, `workspace_id`, `user_id`, `instance_id`, `remote_jid`, `title`, `is_group`, `last_message_at`, `last_message_preview`, `unread_count`
  - Índices criados para performance
  - Suporte multi-tenant com workspace_id e user_id

- ✅ **Tabela `chat_messages`**: Armazena todas as mensagens
  - Campos: `id`, `workspace_id`, `user_id`, `instance_id`, `conversation_id`, `message_id`, `direction`, `from_me`, `sender_jid`, `text`, `media_type`, `media_url`, `caption`, `status`, `timestamp`
  - Idempotência garantida via constraint UNIQUE(instance_id, message_id)
  - Índices criados para busca otimizada

- ✅ **Campo `is_chat_instance`** adicionado em `evolution_instances` para identificar instâncias usadas para chat

- ✅ **Função RPC `increment_unread_count`**: Incrementa contador de não lidas nas conversas

### 2. Backend - APIs REST

#### ✅ `/api/chat/instances` (GET)
- Lista instâncias WhatsApp marcadas como `is_chat_instance = true`
- Suporte multi-tenant (admin vê tudo, usuário vê apenas suas instâncias)
- Validação de permissões implementada

#### ✅ `/api/chat/conversations` (GET)
- Lista conversas de uma instância específica
- Ordenação por última mensagem (mais recente primeiro)
- Validação de acesso à instância

#### ✅ `/api/chat/messages` (GET)
- Lista mensagens de uma conversa
- Paginação com limit/offset
- Zera contador de não lidas ao abrir conversa
- Ordenação cronológica para exibição

#### ✅ `/api/chat/send` (POST)
- Envia mensagens via Evolution API
- Suporte para texto e mídia
- Validação de acesso à instância
- Cria/atualiza conversa automaticamente
- Salva mensagem no banco após envio

### 3. Backend - Webhook Evolution

#### ✅ `/api/webhooks/evolution` (POST)
- Recebe eventos da Evolution API
- Validação de token via query string ou headers
- Tratamento dos eventos:
  - `MESSAGES_UPSERT`: Cria/atualiza conversas e salva mensagens recebidas
  - `MESSAGES_UPDATE`: Atualiza status das mensagens (sent, delivered, read)
  - `MESSAGES_DELETE`: Remove mensagens deletadas
- Normalização de payload Evolution v2 para formato interno
- Extração de texto, mídia, captions
- Incremento automático de contadores de não lidas

#### ✅ `/api/webhooks/evolution` (GET)
- Healthcheck para validar se endpoint está público
- Retorna configuração de token

### 4. Frontend

#### ✅ Página `/chat`
- Interface completa estilo WhatsApp
- Sidebar com lista de conversas
- Área de mensagens com scroll automático
- Input para envio de mensagens
- Seleção de instância WhatsApp
- Visualização de status de mensagens (enviado, entregue, lido)
- Indicadores de não lidas
- Suporte a grupos e conversas individuais

#### ✅ Integração com Supabase Realtime
- Atualização em tempo real de conversas
- Atualização em tempo real de mensagens
- Sincronização automática entre múltiplos clientes

### 5. Serviços

#### ✅ `ChatService` (`lib/services/chat-service.ts`)
- Método `sendMessage()`: Envia mensagens via Evolution API
- Método `normalizeEvolutionEvent()`: Normaliza eventos da Evolution
- Método `upsertConversation()`: Cria/atualiza conversas
- Método `saveMessage()`: Salva mensagens com idempotência

### 6. Segurança e Permissões

- ✅ Validação de autenticação em todas as rotas
- ✅ Controle de acesso multi-tenant (workspace_id, user_id)
- ✅ Admin tem acesso total, usuários veem apenas suas instâncias
- ✅ Validação de token no webhook (configurável via env)

## ❌ O que FALTA para Funcionar

### 1. Ambiente Público (CRÍTICO)

**Problema:** O webhook da Evolution API precisa de uma URL pública acessível. Em localhost, isso não é possível.

**Soluções possíveis:**

#### Opção A: Deploy em Produção
- Fazer deploy da aplicação (Vercel, Netlify, Railway, etc.)
- Configurar URL pública do webhook na Evolution API
- Definir variável de ambiente `EVOLUTION_WEBHOOK_URL` apontando para produção

#### Opção B: Túnel Local (Desenvolvimento)
- Usar ferramentas como **ngrok**, **localtunnel**, ou **cloudflared** para expor localhost
- Configurar URL do túnel na Evolution API
- **Limitação:** URL muda a cada reinício do túnel (versão gratuita)

**Como configurar ngrok:**
```bash
# Instalar ngrok
npm install -g ngrok

# Expor localhost:3000
ngrok http 3000

# Copiar a URL HTTPS (ex: https://abc123.ngrok.io)
# Configurar na Evolution API:
# webhook_url: https://abc123.ngrok.io/api/webhooks/evolution
```

### 2. Configuração do Webhook na Evolution API

Após ter uma URL pública, é necessário configurar o webhook em cada instância:

**Via API da Evolution:**
```bash
POST {base_url}/webhook/set/{instance_name}
{
  "url": "https://seu-dominio.com/api/webhooks/evolution?token=SEU_TOKEN",
  "webhook_by_events": true,
  "webhook_base64": false,
  "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE"]
}
```

**Variáveis de ambiente necessárias:**
```env
EVOLUTION_WEBHOOK_TOKEN=seu_token_secreto
EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN=false  # false em produção, true apenas para testes
```

### 3. Configuração de Instâncias para Chat

Para que uma instância seja usada no chat, é necessário:

1. Marcar a instância como `is_chat_instance = true`:
```sql
UPDATE evolution_instances 
SET is_chat_instance = true 
WHERE instance_name = 'nome_da_instancia';
```

2. Configurar webhook na Evolution API (como descrito acima)

3. Garantir que o campo `workspace_id` e `user_id` estejam preenchidos

### 4. Melhorias Futuras (Opcionais)

- [ ] Suporte completo a mídias (download e armazenamento)
- [ ] Preview de links (Open Graph)
- [ ] Busca de conversas e mensagens
- [ ] Arquivo de conversas
- [ ] Notificações push (quando não estiver na página)
- [ ] Emoji picker
- [ ] Encaminhamento de mensagens
- [ ] Status online/offline
- [ ] Indicadores de digitação
- [ ] Suporte a mensagens de voz
- [ ] Filtros por tipo de conversa (individual, grupo, não lidas)

## 🔧 Como Reativar o Chat

1. **Fazer deploy ou configurar túnel público**
   - Deploy: Fazer deploy em Vercel/Netlify/Railway
   - Túnel: Usar ngrok/localtunnel para desenvolvimento

2. **Configurar variáveis de ambiente:**
   ```env
   EVOLUTION_WEBHOOK_TOKEN=seu_token_secreto_aqui
   EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN=false
   ```

3. **Descomentar o código:**
   - `app/chat/page.tsx` - Remover comentários do código original
   - `app/api/chat/*/route.ts` - Restaurar código original
   - `lib/services/chat-service.ts` - Remover comentários
   - `app/api/webhooks/evolution/route.ts` - Restaurar POST handler
   - `components/Sidebar.tsx` - Descomentar itens do menu

4. **Configurar webhooks na Evolution API:**
   - Chamar endpoint de configuração para cada instância
   - URL: `https://seu-dominio.com/api/webhooks/evolution?token=SEU_TOKEN`

5. **Marcar instâncias para chat:**
   ```sql
   UPDATE evolution_instances SET is_chat_instance = true WHERE ...;
   ```

6. **Testar:**
   - Enviar mensagem via Evolution API
   - Verificar se webhook recebe o evento
   - Verificar se mensagem aparece no chat

## 📝 Arquivos Modificados

### Comentados Temporariamente:
- `app/chat/page.tsx` - Página principal do chat
- `app/api/chat/instances/route.ts` - API de instâncias
- `app/api/chat/conversations/route.ts` - API de conversas
- `app/api/chat/messages/route.ts` - API de mensagens
- `app/api/chat/send/route.ts` - API de envio
- `lib/services/chat-service.ts` - Serviço principal
- `app/api/webhooks/evolution/route.ts` - Handler POST do webhook
- `components/Sidebar.tsx` - Itens do menu comentados

### Mantidos Ativos:
- `migrations/create_chat_tables.sql` - Estrutura do banco
- `app/api/webhooks/evolution/route.ts` - GET handler (healthcheck)

## 🔍 Verificação de Status

Para verificar se o chat está pronto para funcionar:

1. ✅ **Banco de dados:** Tabelas criadas e migração executada
2. ⏸️ **Backend:** APIs comentadas, mas código completo
3. ⏸️ **Frontend:** Interface comentada, mas código completo
4. ❌ **Webhook:** Requer URL pública
5. ❌ **Configuração:** Instâncias precisam ser marcadas e webhook configurado

## 📚 Referências

- [Evolution API Documentation](https://doc.evolution-api.com/)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [ngrok - Túnel Local](https://ngrok.com/)

---

**Nota:** Todo o código está preservado e comentado. Quando o ambiente público estiver disponível, basta descomentar os arquivos listados acima.

