# LEGADO — Scheduled Functions desativadas

> A stack `modelagem` leve não registra Scheduled Functions no Netlify e não
> sobe container cron. Use [DEPLOY_STACK_LEVE.md](./DEPLOY_STACK_LEVE.md).
> O conteúdo abaixo é mantido apenas como histórico da stack completa.

# Configurar Scheduled Function via API

Este guia explica como configurar o scheduled function `process-campaign-queue` via API do Netlify.

## 📋 Pré-requisitos

1. **Netlify Access Token**
   - Acesse: https://app.netlify.com/user/applications
   - Clique em "New access token"
   - Dê um nome (ex: "Scheduled Function Setup")
   - Copie o token gerado

2. **Netlify Site ID**
   - Acesse: https://app.netlify.com/sites
   - Selecione seu site
   - Vá em: **Site settings → General → Site details**
   - Copie o **Site ID**

## 🚀 Método 1: Usando o Script (Recomendado)

### Passo 1: Configure as variáveis de ambiente

**Windows (PowerShell):**
```powershell
$env:NETLIFY_ACCESS_TOKEN="seu_token_aqui"
$env:NETLIFY_SITE_ID="seu_site_id_aqui"
```

**Windows (CMD):**
```cmd
set NETLIFY_ACCESS_TOKEN=seu_token_aqui
set NETLIFY_SITE_ID=seu_site_id_aqui
```

**Linux/Mac:**
```bash
export NETLIFY_ACCESS_TOKEN="seu_token_aqui"
export NETLIFY_SITE_ID="seu_site_id_aqui"
```

**Ou crie um arquivo `.env` na raiz do projeto:**
```env
NETLIFY_ACCESS_TOKEN=seu_token_aqui
NETLIFY_SITE_ID=seu_site_id_aqui
```

### Passo 2: Execute o script

```bash
npm run setup:scheduled-function
```

O script irá:
- ✅ Verificar se o scheduled function já existe
- ✅ Criar ou atualizar a configuração
- ✅ Configurar para rodar a cada 1 minuto (`*/1 * * * *`)

## 🔧 Método 2: Usando cURL (Manual)

### Criar Scheduled Function

```bash
curl -X POST \
  "https://api.netlify.com/api/v1/sites/{SITE_ID}/scheduled_functions" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "process-campaign-queue",
    "cron": "*/1 * * * *",
    "timezone": "UTC"
  }'
```

**Substitua:**
- `{SITE_ID}` pelo seu Site ID
- `{ACCESS_TOKEN}` pelo seu Access Token

### Atualizar Scheduled Function Existente

Primeiro, liste os scheduled functions para obter o ID:

```bash
curl -X GET \
  "https://api.netlify.com/api/v1/sites/{SITE_ID}/scheduled_functions" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

Depois, atualize usando o ID:

```bash
curl -X PUT \
  "https://api.netlify.com/api/v1/sites/{SITE_ID}/scheduled_functions/{FUNCTION_ID}" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cron": "*/1 * * * *",
    "timezone": "UTC"
  }'
```

## 📝 Formato do Cron

O formato usado é: `*/1 * * * *` (a cada 1 minuto)

**Outros exemplos:**
- `0 * * * *` - A cada hora (minuto 0)
- `*/5 * * * *` - A cada 5 minutos
- `0 */2 * * *` - A cada 2 horas
- `0 0 * * *` - Uma vez por dia (meia-noite UTC)

**Formato:** `minuto hora dia mês dia-da-semana`
- `*` = qualquer valor
- `*/n` = a cada n unidades
- `n` = valor específico

## ✅ Verificação

Após configurar, verifique:

1. **No Netlify Dashboard:**
   - Acesse: Functions → Scheduled Functions
   - Deve aparecer `process-campaign-queue` com status "Active"

2. **Logs:**
   - Acesse: Functions → process-campaign-queue → Logs
   - Deve aparecer execuções a cada 1 minuto

3. **Teste manual:**
   - Crie uma campanha
   - Verifique se o primeiro job é processado imediatamente
   - Verifique se os demais jobs são processados pelo worker

## 📊 Atualização de Processados/Falhas na Lista do Admin

Para que a lista de campanhas do admin mostre **Processados** e **Falhas** atualizados (em tempo real ou em ambiente local), configure a URL da função no app:

1. **No Netlify:** após o deploy, a função fica disponível em:
   - `https://SEU-SITE.netlify.app/.netlify/functions/process-campaign-queue`

2. **No ambiente do app** (`.env` ou variáveis do Netlify/Vercel), defina:
   ```env
   PROCESS_CAMPAIGN_QUEUE_URL=https://SEU-SITE.netlify.app/.netlify/functions/process-campaign-queue
   ```

Com isso, ao abrir a seção **Campanhas** no admin com campanhas ativas, o próprio app dispara o processamento da fila a cada atualização (15s), e os números de processados/falhas passam a refletir o banco.

- **Produção (Netlify):** o cron continua rodando a cada 1 minuto; o trigger na lista só antecipa/refresca.
- **Local (npm run dev):** como o cron não roda na sua máquina, o trigger na lista é o que faz a fila ser processada (desde que a URL aponte para o deploy na Netlify).

## 🐛 Troubleshooting

### Erro: "Function not found"
- Certifique-se de que a função `process-campaign-queue` foi deployada
- Verifique se o arquivo está em `netlify/functions/process-campaign-queue.ts`
- Faça um novo deploy

### Erro: "Unauthorized"
- Verifique se o Access Token está correto
- Verifique se o token tem permissões de escrita

### Erro: "Site not found"
- Verifique se o Site ID está correto
- Verifique se você tem acesso ao site

### Worker não está rodando
- Verifique os logs do Netlify
- Verifique se o scheduled function está "Active"
- Verifique se o cron está correto

## 📚 Referências

- [Netlify Scheduled Functions](https://docs.netlify.com/functions/trigger-on-events/scheduled-functions/)
- [Netlify API](https://docs.netlify.com/api/get-started/)
- [Cron Expression](https://crontab.guru/)
