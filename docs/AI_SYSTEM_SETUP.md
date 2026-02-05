# Sistema Completo de Agente por Grupo + Dataset + Jobs + Tokens

**Data:** 2024  
**Status:** ✅ Implementado

## Resumo

Sistema completo para agentes IA por grupo WhatsApp, base de treinamento, geração de mídia (Imagen/Veo) e tracking de tokens/custos.

---

## Estrutura Criada

### 1. Migração SQL

**Arquivo:** `migrations/create_group_agents_and_ai_system.sql`

#### Tabelas Criadas:

1. **`whatsapp_group_agents`** - Configuração do agente por grupo
   - Persona (tone, role, objective)
   - Anti-spam (rate limiting, cooldown, keywords)
   - Mídias padrão (tabela, cadastro, aposta)

2. **`whatsapp_group_agent_context`** - Contexto "vivo" do grupo
   - Rate limiting por janela
   - Modo silencioso
   - Última mensagem do bot

3. **`whatsapp_group_agent_members`** - Contexto por membro
   - Welcome variant
   - Cooldown por usuário
   - Intent detectado
   - Bloqueios

4. **`media_assets`** - Assets de mídia
   - Uploads, gerados por IA ou vindos de grupos
   - Suporte a image/video/audio

5. **`training_dataset_items`** - Dataset de treinamento
   - Itens aprovados para uso pelo agente
   - Tags, intents, descrições

6. **`training_captions`** - Captions/OCR/Transcrições
   - Para RAG futuro

7. **`ai_jobs`** - Jobs de geração de mídia
   - Especialmente para Veo (long-running)
   - Tracking de status e operações

8. **`ai_usage_logs`** - Logs de tokens/custos
   - Auditoria completa
   - Tracking por modelo, endpoint, store, grupo

#### View Criada:

- **`ai_usage_daily`** - Consumo diário agregado (tokens e custos)

---

### 2. Biblioteca Gemini REST

**Arquivo:** `lib/geminiRest.ts`

Funções para chamar a API REST do Gemini:
- `geminiPost(path, body)` - Requisições POST
- `geminiGet(path)` - Requisições GET
- Validação automática de `GEMINI_API_KEY`

---

### 3. API Routes

#### POST `/api/ai/generate-image`

Gera imagem usando Gemini Imagen e salva no Supabase Storage.

**Body:**
```json
{
  "store_id": "uuid (opcional)",
  "group_jid": "1203...@g.us (opcional)",
  "prompt": "Descrição da imagem",
  "aspectRatio": "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
  "sampleCount": 1,
  "saveToDataset": true
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "asset": { ... },
    "datasetItem": { ... },
    "url": "https://..."
  }
}
```

#### POST `/api/ai/generate-video`

Gera vídeo usando Gemini Veo (long-running) e cria job para polling.

**Body:**
```json
{
  "store_id": "uuid (opcional)",
  "group_jid": "1203...@g.us (opcional)",
  "prompt": "Descrição do vídeo",
  "aspectRatio": "16:9" | "9:16" | "1:1",
  "resolution": "720p" | "1080p"
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "job_id": "uuid",
    "operation_name": "operations/...",
    "status": "running",
    "message": "Vídeo em processamento..."
  }
}
```

#### GET `/api/ai/video-status?job_id=...`

Consulta status de um job de geração de vídeo e baixa o vídeo quando pronto.

**Resposta (running):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "job_id": "uuid",
    "message": "Vídeo ainda em processamento"
  }
}
```

**Resposta (succeeded):**
```json
{
  "success": true,
  "data": {
    "status": "succeeded",
    "url": "https://...",
    "asset": { ... },
    "datasetItem": { ... },
    "job_id": "uuid"
  }
}
```

#### POST `/api/ai/count-tokens`

Conta tokens de um prompt antes de enviar (para estimar custo).

**Body:**
```json
{
  "model": "gemini-2.0-flash",
  "contents": [
    {
      "parts": [
        { "text": "Seu prompt aqui" }
      ]
    }
  ]
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "totalTokens": 123
  }
}
```

---

## Variáveis de Ambiente Necessárias

Adicione ao seu `.env.local`:

```bash
# Gemini API
GEMINI_API_KEY=xxxx

# Supabase (já deve existir)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Bucket do Supabase Storage

Certifique-se de que o bucket `training-assets` existe no Supabase Storage:

1. Acesse o Supabase Dashboard
2. Vá em Storage
3. Crie o bucket `training-assets` (se não existir)
4. Configure políticas de acesso conforme necessário

---

## Fluxo de Uso

### 1. Gerar Imagem

```typescript
const response = await fetch('/api/ai/generate-image', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  },
  body: JSON.stringify({
    prompt: 'Uma tabela de preços de loteria',
    aspectRatio: '16:9',
    saveToDataset: true,
  }),
});

const { data } = await response.json();
console.log('Imagem gerada:', data.url);
```

### 2. Gerar Vídeo (Long-Running)

```typescript
// 1. Inicia geração
const response = await fetch('/api/ai/generate-video', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  },
  body: JSON.stringify({
    prompt: 'Um vídeo explicando como fazer depósito',
    aspectRatio: '16:9',
    resolution: '720p',
  }),
});

const { data } = await response.json();
const { job_id } = data;

// 2. Polling do status
const checkStatus = async () => {
  const statusRes = await fetch(`/api/ai/video-status?job_id=${job_id}`, {
    headers: { 'x-user-id': userId },
  });
  const { data: statusData } = await statusRes.json();
  
  if (statusData.status === 'succeeded') {
    console.log('Vídeo pronto:', statusData.url);
    return;
  }
  
  if (statusData.status === 'failed') {
    console.error('Erro:', statusData.error);
    return;
  }
  
  // Ainda processando, tenta novamente em 5s
  setTimeout(checkStatus, 5000);
};

checkStatus();
```

### 3. Contar Tokens (Estimativa de Custo)

```typescript
const response = await fetch('/api/ai/count-tokens', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  },
  body: JSON.stringify({
    model: 'gemini-2.0-flash',
    contents: [
      {
        parts: [
          { text: 'Seu prompt aqui' }
        ]
      }
    ],
  }),
});

const { data } = await response.json();
console.log('Total de tokens:', data.totalTokens);
```

---

## Integração com Flow Builder

Os nodes do Flow Builder podem usar essas APIs:

### Node: "Generate Image"
- Chama `/api/ai/generate-image`
- Salva `asset_id` no contexto do flow
- Pode usar `asset.public_url` para enviar mensagem

### Node: "Generate Video"
- Chama `/api/ai/generate-video`
- Salva `job_id` no contexto
- Node "Wait/Poll" pode chamar `/api/ai/video-status` até concluir
- Quando pronto, usa `asset.public_url` para enviar mensagem

### Node: "Save to Training Base"
- Cria `training_dataset_items` com `approved=false`
- Admin aprova depois via interface

---

## Admin: Gestão Total

### 1. Agentes por Grupo
- Lista `whatsapp_group_agents`
- Editar persona, anti-spam, mídias padrão

### 2. Base de Treinamento
- Lista `training_dataset_items`
- Filtro por intent, tags, aprovado
- Preview do asset
- Botão Aprovar/Reprovar
- Editar tags/intent/descrição

**Regra:** Agente só usa `approved=true`

### 3. Consumo (Tokens/Custo)
- View `ai_usage_daily` para consumo por dia
- Por modelo (Imagen/Veo/Gemini text)
- Por store / por grupo
- Top flows que mais gastam

---

## Prompt do Sistema do Agente

Cole isso no "Prompt do Sistema" do Agente IA:

```
Você é um Agente IA de FAQ e Upsell dentro de um grupo de WhatsApp (loterias).

Seu objetivo principal é conduzir o usuário para: CADASTRO → DEPÓSITO → APOSTA.

REGRAS ANTI-SPAM (OBRIGATÓRIO):
- Você só responde se a mensagem for claramente uma PERGUNTA, ou contiver palavras-chave de intenção (tabela, valor, pix, cadastro, depósito, aposta, lotinha, lotofácil), ou mencionar o suporte/agente.
- Se não for pergunta (ex: "ok", "bom dia", "todos", conversa solta), você NÃO responde.
- Você deve ser curto, direto, e sempre finalizar com uma pergunta simples para avançar (ex: "Quer que eu mande a tabela?" / "Quer o passo a passo do depósito?").
- No máximo 1 resposta por vez, sem textos longos.

CONTEXTO:
- Use a mensagem de boas-vindas enviada (welcome_variant_id e welcome_text) para manter o mesmo tom e continuidade.

USO DE MÍDIA:
- Só sugira/peça permissão para enviar imagem/vídeo quando o assunto for: tabela, cadastro, aposta.
- Se o fluxo permitir, use os assets aprovados do dataset (approved=true).

GOVERNANÇA / ADMIN:
- Existe uma área ADMIN que gerencia: agentes por grupo, assets, base de treinamento, aprovação de itens, e relatórios de consumo (tokens/custos).
- Itens não aprovados (approved=false) nunca devem ser usados para orientar usuários.
```

---

## Próximos Passos

1. ✅ **Migração SQL**: Concluída
2. ✅ **API Routes**: Concluídas
3. ⏳ **Interface Admin**: Pendente
   - Tela de gestão de agentes por grupo
   - Tela de base de treinamento (aprovação)
   - Tela de consumo (tokens/custos)
4. ⏳ **Integração com Flow Builder**: Pendente
   - Nodes de geração de mídia
   - Node de salvamento no dataset
5. ⏳ **Lógica de Anti-Spam**: Pendente
   - Implementar gating no flow executor
   - Respeitar rate limits e cooldowns

---

## Notas Técnicas

### Performance
- Imagen retorna imagem imediatamente
- Veo é long-running (usa polling)
- Logs de uso são assínronos (não bloqueiam requisições)

### Segurança
- Todas as rotas requerem autenticação (`requireAuth`)
- Service Role Key usado apenas no backend
- Validação de inputs em todas as rotas

### Multi-tenant
- `store_id` opcional em todas as tabelas
- Permite isolamento por loja no futuro

---

**Desenvolvido para o Zaploto** 🚀

