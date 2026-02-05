# Sistema de Maturação - Documentação

## Visão Geral

O Sistema de Maturação permite executar diagnósticos e maturação em instâncias mestre do WhatsApp usando requests para a Evolution API. O sistema suporta:

- **Maturação manual/agendada** (instâncias mestre): botão Start e cron (maturation-scheduler).
- **Auto maturação virgem (5 dias)**: na criação da instância, o tipo pode ser "virgem" ou "maturado". Se virgem, após escanear o QR Code a instância entra automaticamente em maturação por 5 dias (bloqueada para campanhas e fluxos), com etapas: teste de conexão (24h), conversas 1:1 (2h), grupo (24h), posting status, ciclo repetido (dias 2-5). O maturation-tick processa tanto os steps dos jobs mestre quanto o fluxo virgem.

## Arquitetura

### Componentes Principais

1. **Banco de Dados (Supabase)**
   - `master_instances`: Instâncias mestre disponíveis
   - `maturation_plans`: Planos de maturação com steps configurados
   - `maturation_jobs`: Jobs de execução
   - `maturation_steps`: Steps individuais de cada job
   - `maturation_messages`: Feed de mensagens para UI (estilo WhatsApp)

2. **Netlify Functions**
   - `maturation-start`: Inicia jobs manuais (POST)
   - `maturation-tick`: Processa steps devidos (scheduled, 1 min) e fluxo virgem (instâncias em maturação 5 dias)
   - `maturation-scheduler`: Cria jobs agendados (scheduled, 10 min)

3. **API Routes (Next.js)**
   - `/api/maturation/jobs`: Lista e cria jobs
   - `/api/maturation/jobs/[jobId]`: Detalhes e controle de job
   - `/api/maturation/jobs/[jobId]/messages`: Feed de mensagens
   - `/api/maturation/plans`: Lista planos
   - `/api/maturation/master-instances`: Lista instâncias mestre
   - `/api/maturation/virgin-instances`: Lista instâncias em maturação virgem (admin)
   - `/api/maturation/virgin-instances/[id]`: Ações admin (pause, resume, force_complete, restart, block)
   - `/api/maturation/virgin-instances/[id]/logs`: Logs de maturação virgem

4. **UI**
   - `/app/maturador`: Interface principal estilo WhatsApp
   - `/app/admin/maturador`: Painel admin para gerenciar instâncias, planos e mídias

## Configuração

### Variáveis de Ambiente

```env
# Supabase (obrigatórias)
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role

# Maturação (opcionais)
MATURATION_MIN_HEALTH_SCORE=80
MATURATION_MAX_HOURS_SINCE_LAST_JOB=24
MATURATION_DEFAULT_PLAN_ID=uuid-do-plano-padrao
```

### Netlify Functions

As funções agendadas são configuradas no `netlify.toml`:

```toml
[functions]
  [functions."maturation-tick"]
    schedule = "*/1 * * * *"  # A cada 1 minuto
  [functions."maturation-scheduler"]
    schedule = "*/10 * * * *"  # A cada 10 minutos
```

### Supabase Storage

- **maturation-videos**: vídeos de teste do maturador manual.
- **virgin-maturation-media**: mídias do fluxo do Auto maturador (vídeo, imagem, áudio). Criado pela migration `create_virgin_maturation_media_bucket.sql`. Upload via `/api/admin/maturation/virgin-messages/upload`; o `maturation-tick` gera URLs assinadas para enviar via Evolution API (sendText, sendMedia, sendWhatsAppAudio).

## Migração do Banco de Dados

Execute as migrations SQL:

```bash
# No Supabase Dashboard > SQL Editor, execute:
zaplotoapp/migrations/create_maturation_system.sql
zaplotoapp/migrations/add_virgin_maturation_to_evolution_instances.sql
```

Isso criará:
- Todas as tabelas necessárias
- Índices para performance
- Função RPC `claim_maturation_steps` (idempotência)
- RLS (Row Level Security) policies

## Uso

### 1. Criar Instância Mestre

No admin (`/app/admin/maturador`), marque uma instância como mestre:

```sql
INSERT INTO master_instances (evolution_instance_id, is_active)
VALUES ('uuid-da-evolution-instance', true);
```

### 2. Criar Plano de Maturação

```sql
INSERT INTO maturation_plans (name, is_active, steps_json, default_target_chat_id)
VALUES (
  'Plano Teste',
  true,
  '[
    {"type": "text", "delaySec": 0, "payload": {"text": "Olá! Este é um teste."}},
    {"type": "text", "delaySec": 60, "payload": {"text": "Segunda mensagem após 1 minuto."}},
    {"type": "video", "delaySec": 120, "payload": {"assetPath": "maturation-videos/teste.mp4", "caption": "Vídeo de teste"}}
  ]'::jsonb,
  '120363123456789@g.us'
);
```

### 3. Iniciar Job Manual

Na interface `/app/maturador`:
1. Selecione um plano
2. Informe o `target_chat_id` (grupo/chat de teste)
3. Clique em "Start"

### 4. Acompanhar Progresso

O feed estilo WhatsApp mostra:
- Mensagens do sistema (cinza)
- Mensagens da instância (verde/azul)
- Status, latência, HTTP status
- Erros e retries

## Idempotência

O sistema usa `FOR UPDATE SKIP LOCKED` na função RPC `claim_maturation_steps` para garantir que um step nunca seja processado duas vezes, mesmo com retries de função.

## Retry e Backoff

Steps que falham são reagendados com backoff exponencial:
- Tentativa 1: 1 minuto
- Tentativa 2: 3 minutos
- Tentativa 3: 10 minutos

Após 3 tentativas (configurável via `max_attempts`), o step é marcado como `failed`.

## Segurança

- RLS (Row Level Security) configurado no Supabase
- Usuários só veem seus próprios jobs
- Admins veem todos os jobs
- Validação de JWT em todas as API routes

## Troubleshooting

### Job não inicia
- Verifique se há instâncias mestre disponíveis (`is_active=true`, `is_locked=false`)
- Verifique se o plano está ativo
- Verifique logs da Netlify Function `maturation-start`

### Steps não são processados
- Verifique se `maturation-tick` está rodando (logs no Netlify)
- Verifique se `scheduled_at <= now()`
- Verifique se o job está com `status='running'`

### Erros de Evolution API
- Verifique se a instância está conectada
- Verifique se a API key está correta
- Verifique logs em `maturation_messages` para detalhes do erro

## Próximos Passos

- [ ] Implementar CRUD completo de planos no admin
- [ ] Implementar upload de mídias no admin
- [ ] Adicionar métricas e dashboards
- [ ] Suporte a mais tipos de mídia (imagem, áudio)
- [ ] Webhooks para notificações de conclusão

