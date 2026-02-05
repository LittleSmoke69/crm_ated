# Webhook Evolution - Guia de Implementação

Este documento descreve a implementação do sistema de webhooks para receber eventos da Evolution API.

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Configuração do Banco de Dados](#configuração-do-banco-de-dados)
- [Configuração dos Webhooks na Evolution API](#configuração-dos-webhooks-na-evolution-api)
- [Testando os Webhooks](#testando-os-webhooks)
- [Estrutura do Sistema](#estrutura-do-sistema)

---

## 🎯 Visão Geral

O sistema implementa dois endpoints de webhook (PROD e TEST) para receber eventos da Evolution API, armazena-os no banco de dados (Supabase) para auditoria e oferece uma interface administrativa para monitoramento em tempo real.

### Funcionalidades

1. **Webhooks PROD e TEST**: Endpoints separados para produção e testes
2. **Auditoria**: Todos os eventos são salvos no banco de dados
3. **Monitoramento em Tempo Real**: Interface admin com status dos webhooks
4. **Teste Estilo n8n**: Sistema de "waiters" para aguardar eventos durante testes

---

## 🔧 Variáveis de Ambiente

Adicione as seguintes variáveis de ambiente ao seu projeto (`.env.local` ou Netlify Environment Variables):

```env
# Supabase (já deve existir no projeto)
NEXT_PUBLIC_SUPABASE_URL=sua_url_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role

# Webhooks Evolution
EVOLUTION_WEBHOOK_SECRET_PROD=seu_token_secreto_prod
EVOLUTION_WEBHOOK_SECRET_TEST=seu_token_secreto_test

# Admin (opcional - se não usar o middleware de auth existente)
ADMIN_TOKEN=token_admin_opcional
```

### Como Gerar os Tokens

Você pode gerar tokens seguros usando qualquer método:

```bash
# Opção 1: Usando OpenSSL
openssl rand -hex 32

# Opção 2: Usando Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Opção 3: Gerador online seguro
# Use um gerador de tokens seguro online
```

**Importante**: Use tokens diferentes para PROD e TEST.

---

## 🗄️ Configuração do Banco de Dados

### 1. Executar a Migration

Execute o arquivo SQL de migration no Supabase:

```bash
# Via Supabase Dashboard
# 1. Acesse o SQL Editor
# 2. Cole o conteúdo de: zaplotoapp/migrations/create_evolution_webhook_tables.sql
# 3. Execute

# OU via CLI (se tiver configurado)
supabase db reset
```

### 2. Verificar Tabelas Criadas

Execute a seguinte query para verificar:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('evolution_webhook_events', 'evolution_webhook_test_waiters');
```

---

## 🔗 Configuração dos Webhooks na Evolution API

### URLs dos Webhooks

Após fazer o deploy na Netlify, você terá as seguintes URLs:

**PROD:**
```
https://seu-dominio.netlify.app/api/webhooks/evolution/prod
```

**TEST:**
```
https://seu-dominio.netlify.app/api/webhooks/evolution/test
```

### Configuração na Evolution API

1. Acesse o painel da Evolution API
2. Vá em **Webhooks** ou **Configurações**
3. Configure os webhooks:

   **Para PROD:**
   - URL: `https://seu-dominio.netlify.app/api/webhooks/evolution/prod`
   - Header: `x-zaploto-token: seu_token_secreto_prod` (valor de `EVOLUTION_WEBHOOK_SECRET_PROD`)
   - Método: `POST`
   - Content-Type: `application/json`

   **Para TEST:**
   - URL: `https://seu-dominio.netlify.app/api/webhooks/evolution/test`
   - Header: `x-zaploto-token: seu_token_secreto_test` (valor de `EVOLUTION_WEBHOOK_SECRET_TEST`)
   - Método: `POST`
   - Content-Type: `application/json`

### Eventos Suportados

O webhook recebe qualquer evento da Evolution API e normaliza automaticamente os metadados:

- `event_type`: Extraído de `payload.event`, `payload.type`, `payload.data.event` ou `"unknown"`
- `instance_name`: Extraído de `payload.instance.instanceName`, `payload.instanceName`, etc.
- `remote_jid`: Extraído de `payload.data.key.remoteJid`, etc.
- `message_id`: Extraído de `payload.data.key.id`, etc.

---

## 🧪 Testando os Webhooks

### 1. Teste Básico com cURL

**Teste PROD:**
```bash
curl -X POST https://seu-dominio.netlify.app/api/webhooks/evolution/prod \
  -H "Content-Type: application/json" \
  -H "x-zaploto-token: seu_token_secreto_prod" \
  -d '{
    "event": "MESSAGES_UPSERT",
    "instanceName": "test-instance",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "id": "test-message-id"
      }
    }
  }'
```

**Teste TEST:**
```bash
curl -X POST https://seu-dominio.netlify.app/api/webhooks/evolution/test \
  -H "Content-Type: application/json" \
  -H "x-zaploto-token: seu_token_secreto_test" \
  -d '{
    "event": "MESSAGES_UPSERT",
    "instanceName": "test-instance",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "id": "test-message-id"
      }
    }
  }'
```

### 2. Teste de Healthcheck

```bash
# PROD
curl https://seu-dominio.netlify.app/api/webhooks/evolution/prod

# TEST
curl https://seu-dominio.netlify.app/api/webhooks/evolution/test
```

### 3. Teste via Interface Admin

1. Acesse `/admin/webhooks/evolution` no painel admin
2. Clique em "Aguardar evento (TESTE)"
3. Envie um evento para o webhook TEST
4. O status muda automaticamente para "Recebido ✅"

---

## 📁 Estrutura do Sistema

### Endpoints Webhook

- `POST /api/webhooks/evolution/prod` - Recebe eventos de produção
- `POST /api/webhooks/evolution/test` - Recebe eventos de teste
- `GET /api/webhooks/evolution/prod` - Healthcheck PROD
- `GET /api/webhooks/evolution/test` - Healthcheck TEST

### APIs Admin (Protegidas)

- `POST /api/admin/webhooks/evolution/test-waiters` - Cria waiter para teste
- `GET /api/admin/webhooks/evolution/test-waiters/:id` - Busca status do waiter
- `GET /api/admin/webhooks/evolution/events` - Lista eventos com filtros
- `GET /api/admin/webhooks/evolution/status` - Retorna status dos webhooks

### Interface Admin

- `/admin/webhooks/evolution` - Página de monitoramento completa

### Tabelas do Banco

1. **evolution_webhook_events**: Armazena todos os eventos recebidos
   - `id` (uuid)
   - `received_at` (timestamptz)
   - `env` ('prod' | 'test')
   - `event_type` (text)
   - `instance_name` (text)
   - `remote_jid` (text)
   - `message_id` (text)
   - `payload` (jsonb)

2. **evolution_webhook_test_waiters**: Sistema de waiters para testes
   - `id` (uuid)
   - `created_at` (timestamptz)
   - `status` ('waiting' | 'received' | 'expired')
   - `expires_at` (timestamptz)
   - `received_event_id` (uuid, FK)
   - `received_at` (timestamptz)
   - `env` ('test' | 'prod')

---

## 🔐 Segurança

### Validação de Token

- Os webhooks validam o token via header `x-zaploto-token`
- Tokens diferentes para PROD e TEST
- Retorna 401 se token inválido ou ausente

### Autenticação Admin

- As APIs admin usam o middleware `requireAdmin` existente
- Valida se o usuário tem status `'admin'` na tabela `profiles`
- Fallback para `ADMIN_TOKEN` (se necessário no futuro)

### Rate Limiting

- Os webhooks retornam 200 imediatamente (não bloqueiam a Evolution API)
- Erros são logados mas não impedem o retorno 200 (para não bloquear a Evolution)

---

## 📊 Monitoramento

### Status dos Webhooks

A interface admin mostra:

- **Último evento**: Timestamp do último evento recebido
- **Status visual**: 
  - 🟢 Verde: < 2 minutos atrás
  - 🟡 Amarelo: < 10 minutos atrás
  - 🔴 Vermelho: > 10 minutos atrás ou nunca

### Lista de Eventos

- Filtros por ambiente (PROD/TEST)
- Filtros por tipo de evento
- Busca por instância, JID ou Message ID
- Paginação (25 itens por página)
- Visualização do payload completo (JSON formatado)

---

## 🐛 Troubleshooting

### Webhook não recebe eventos

1. Verifique se as variáveis de ambiente estão configuradas
2. Verifique se o token está correto no header da Evolution API
3. Verifique os logs do Netlify Functions
4. Teste com cURL primeiro para isolar o problema

### Waiter não detecta evento

1. Verifique se o webhook TEST está configurado corretamente
2. Verifique se o evento foi enviado para o webhook TEST (não PROD)
3. Verifique se o waiter não expirou (válido por 2 minutos)

### Erro 401 Unauthorized

1. Verifique se o header `x-zaploto-token` está sendo enviado
2. Verifique se o token corresponde à variável de ambiente correta (PROD ou TEST)
3. Verifique se as variáveis de ambiente estão configuradas na Netlify

---

## 📝 Notas Adicionais

- O webhook sempre retorna 200 para não bloquear a Evolution API, mesmo em caso de erro
- Erros são logados no console do servidor
- O sistema de waiters expira após 2 minutos
- Eventos duplicados são prevenidos por índice único (`instance_name` + `message_id`)

---

## ✅ Checklist de Deploy

- [ ] Variáveis de ambiente configuradas na Netlify
- [ ] Migration SQL executada no Supabase
- [ ] Tokens gerados e configurados
- [ ] Webhooks configurados na Evolution API
- [ ] Teste com cURL realizado com sucesso
- [ ] Interface admin acessível e funcional
- [ ] Eventos chegando e sendo salvos no banco

---

**Desenvolvido para o Zaploto** 🚀

