# Setup do Sistema de Campanhas com Mídia

Este documento descreve como configurar e usar o sistema de campanhas com upload de mídia no Zaploto.

## 📋 Pré-requisitos

- Projeto Next.js (App Router) configurado
- Supabase configurado e funcionando
- Variáveis de ambiente configuradas

## 🔧 Configuração

### 1. Variáveis de Ambiente

Certifique-se de ter as seguintes variáveis no arquivo `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon_do_supabase
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role_do_supabase
```

**Importante:** A `SUPABASE_SERVICE_ROLE_KEY` deve ser mantida em segredo e nunca exposta no client-side.

### 2. Banco de Dados

Execute o SQL de migração no Supabase SQL Editor:

```sql
-- Arquivo: migrations/create_campaigns_table.sql
```

**IMPORTANTE:** Se você já executou a migration anteriormente e está recebendo erro de foreign key, execute também:

```sql
-- Arquivo: migrations/fix_campaigns_media_owner_id_fkey.sql
```

Este script corrige a foreign key para referenciar `profiles(id)` ao invés de `auth.users(id)`, que é o padrão usado no projeto.

O script cria:
- Tabela `campaigns_media` com todos os campos necessários
- Índices para performance
- RLS (Row Level Security) policies
- Trigger para atualizar `updated_at`
- Foreign key correta para `profiles(id)`

### 3. Supabase Storage

1. Acesse o Supabase Dashboard → Storage
2. Crie um novo bucket chamado `campaign-media`
3. **IMPORTANTE:** Configure o bucket como **PRIVATE** (não público)
4. A estrutura de pastas será criada automaticamente: `campaigns/{campaign_id}/{media_type}/{uuid}.{ext}`

### 4. Estrutura de Arquivos Criados

```
zaplotoapp/
├── migrations/
│   └── create_campaigns_table.sql          # SQL de criação da tabela campaigns_media
├── lib/
│   └── supabase/
│       ├── client.ts                       # Cliente para browser
│       └── server.ts                       # Cliente para servidor
├── app/
│   └── api/
│       └── campaigns/
│           ├── create-with-media/
│           │   └── route.ts                # Cria campanha + gera signed upload URL
│           ├── finalize-media/
│           │   └── route.ts                # Finaliza upload e marca como ready
│           └── get-signed-media-url/
│               └── route.ts                # Gera signed URL para leitura (disparo)
└── components/
    └── CampaignModal.tsx                   # Modal com preview local
```

## 🚀 Como Usar

### No Frontend

O modal já está integrado na página `/crm/activations`. Basta clicar no botão **"Nova campanha com mídia"**.

### Fluxo Completo

1. **Usuário seleciona arquivo:**
   - Validação de tipo (image/video/audio)
   - Validação de tamanho (15MB imagem, 60MB vídeo, 15MB áudio)
   - Preview local (sem upload ainda)

2. **Usuário clica em "Confirmar criação":**
   - Cria registro no banco com status `pending_upload`
   - Gera signed upload URL no backend
   - Faz upload direto do browser para Storage via signed URL
   - Finaliza atualizando status para `ready`

3. **Para disparo (Evolution API):**
   - Chama `/api/campaigns/get-signed-media-url` com `campaignId`
   - Recebe signed URL temporária
   - Usa a URL para enviar mídia via Evolution API

## 📡 Endpoints da API

### POST `/api/campaigns/create-with-media`

Cria uma campanha e gera signed upload URL.

**Headers:**
```
X-User-Id: {userId}
Content-Type: application/json
```

**Body:**
```json
{
  "text": "Texto da campanha",
  "mediaType": "image" | "video" | "audio",
  "mime": "image/jpeg",
  "size": 1024000,
  "originalName": "foto.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "bucket": "campaign-media",
    "path": "campaigns/{userId}/{mediaType}/{uuid}.{ext}",
    "token": "signed-upload-token",
    "signedUrl": "https://..."
  }
}
```

### POST `/api/campaigns/finalize-media`

Finaliza o upload e marca campanha como `ready`.

**Headers:**
```
X-User-Id: {userId}
Content-Type: application/json
```

**Body:**
```json
{
  "campaignId": "uuid",
  "bucket": "campaign-media",
  "path": "campaigns/...",
  "mime": "image/jpeg",
  "size": 1024000,
  "mediaType": "image"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": { ... },
    "message": "Campanha finalizada com sucesso"
  }
}
```

### POST `/api/campaigns/get-signed-media-url`

Gera signed URL para leitura da mídia (para disparo).

**Headers:**
```
X-User-Id: {userId}
Content-Type: application/json
```

**Body:**
```json
{
  "campaignId": "uuid",
  "expiresInSeconds": 3600
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://...",
    "expiresAt": "2024-01-01T12:00:00Z",
    "campaignId": "uuid"
  }
}
```

## 🔒 Segurança

- **RLS habilitado:** Usuários só podem acessar suas próprias campanhas
- **Bucket privado:** Mídia nunca é pública, apenas via signed URLs
- **Validação de ownership:** Todos os endpoints validam que o usuário é dono da campanha
- **Validação de tipos:** Apenas MIME types permitidos são aceitos
- **Validação de tamanho:** Limites por tipo de mídia

## 📝 Status da Campanha

- `draft`: Rascunho (sem mídia)
- `pending_upload`: Aguardando upload
- `ready`: Pronta para uso
- `error`: Erro no processo

## 🐛 Troubleshooting

### Erro: "Erro ao gerar URL de upload assinada"

- Verifique se o bucket `campaign-media` existe
- Verifique se o bucket está configurado como PRIVATE
- Verifique as permissões do service role key

### Erro: "Campanha não encontrada"

- Verifique se o `campaignId` está correto
- Verifique se o usuário é o dono da campanha (RLS)

### Preview não aparece

- Verifique se o tipo de arquivo é suportado
- Verifique o console do browser para erros
- Certifique-se de que `URL.createObjectURL` está funcionando

### Upload falha

- Verifique o tamanho do arquivo (limites: 15MB imagem, 60MB vídeo, 15MB áudio)
- Verifique a conexão de internet
- Verifique os logs do servidor

## 📚 Exemplo de Uso no Código

```typescript
// Criar campanha com mídia
const response = await fetch('/api/campaigns/create-with-media', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  },
  body: JSON.stringify({
    text: 'Texto da campanha',
    mediaType: 'image',
    mime: 'image/jpeg',
    size: file.size,
    originalName: file.name,
  }),
});

const { campaignId, bucket, path, token } = await response.json();

// Upload do arquivo
await supabaseClient.storage
  .from(bucket)
  .uploadToSignedUrl(path, token, file);

// Finalizar
await fetch('/api/campaigns/finalize-media', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  },
  body: JSON.stringify({
    campaignId,
    bucket,
    path,
    mime: file.type,
    size: file.size,
    mediaType: 'image',
  }),
});
```

## ✅ Checklist de Implementação

- [x] SQL de migração criado
- [x] Tabela `campaigns_media` com RLS
- [x] Bucket `campaign-media` criado (PRIVATE)
- [x] Endpoint `create-with-media`
- [x] Endpoint `finalize-media`
- [x] Endpoint `get-signed-media-url`
- [x] Componente `CampaignModal` com preview
- [x] Integração na página `/crm/activations`
- [x] Validações de tipo e tamanho
- [x] Tratamento de erros
- [x] Documentação

## 🎯 Próximos Passos

1. Testar o fluxo completo end-to-end
2. Adicionar barra de progresso de upload (opcional)
3. Integrar com Evolution API para disparo
4. Adicionar listagem de campanhas criadas
5. Adicionar edição/exclusão de campanhas

