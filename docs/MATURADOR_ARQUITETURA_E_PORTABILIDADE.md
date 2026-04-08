# Maturador no ZaplotoV2 — arquitetura e portabilidade

Documento de referência para entender **como o maturador está montado** no projeto e **replicar ou adaptar** em outra aplicação. Complementa a visão operacional de [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md) (variáveis, cron, troubleshooting).

---

## 1. Dois modos de operação

### A) Maturador manual (instâncias mestre)

- Planos em `maturation_plans` com sequência de passos em JSON: texto, vídeo (e na UI/admin também imagem/áudio em alguns fluxos).
- Cada execução vira um **job** (`maturation_jobs`) ligado a:
  - **usuário dono** (`owner_user_id`),
  - **plano**,
  - **instância mestre** (`master_instances` → `evolution_instances`),
  - **chat alvo** (`target_chat_id`, ex.: grupo `@g.us` ou número).
- Os passos são **materializados** em `maturation_steps` com `scheduled_at` (início + `delaySec` entre passos).
- Um **worker periódico** (tick) **reivindica** passos devidos, chama a **Evolution API** direto (`sendText`, `sendMedia`, `sendWhatsAppAudio`) e atualiza status, latência e erros.
- A interface mostra um **feed estilo WhatsApp** (`maturation_messages`).

### B) Auto maturador virgem (~5 dias)

- Em `evolution_instances`, `maturation_type` pode ser `virgem` ou `maturado`.
- Se for **virgem**, após conectar, a instância segue uma **máquina de estados** (`maturation_status`: teste de conexão, warmup 1:1, grupo, posting de status, ciclo repetido, etc.), com **bloqueio** de uso “normal” (campanhas/fluxos) até concluir.
- O **mesmo tick** que processa jobs manuais executa `processVirginMaturation()` em `lib/services/maturation/processor.ts`: avança fases pelo tempo e dispara envios (incluindo mídias do bucket `virgin-maturation-media`).
- Tabelas auxiliares: `virgin_maturation_groups`, `virgin_maturation_logs`.

---

## 2. Modelo de dados (Supabase)

| Tabela | Papel |
|--------|--------|
| `master_instances` | Quais `evolution_instances` são mestre; `is_locked` / `locked_job_id` evitam dois jobs simultâneos na mesma instância; `health_score`, `last_seen_at`. |
| `maturation_plans` | Nome, `steps_json`, `default_target_chat_id`, `is_active`. |
| `maturation_jobs` | Execução: dono, plano, mestre, `target_chat_id`, `status` (`queued` → `running` → `finished` / `failed` / `paused` / `aborted`), progresso. |
| `maturation_steps` | Um registro por passo: `step_index`, `type`, `payload_json`, `scheduled_at`, `status`, tentativas, erro, HTTP, etc. |
| `maturation_messages` | Feed para a UI (system / instance, texto, vídeo, info, erro, retry). |
| `evolution_instances` (colunas virgem) | `maturation_type`, `maturation_status`, datas, `current_day`, `is_locked`, `maturation_paused_at`, … |
| RPC `claim_maturation_steps` | **Claim atômico** com `FOR UPDATE SKIP LOCKED`: um único worker por step; marca `processing` + `locked_by`. |

**Migrations principais**

- `migrations/create_maturation_system.sql`
- `migrations/add_virgin_maturation_to_evolution_instances.sql`
- Bucket de mídia virgem: `migrations/create_virgin_maturation_media_bucket.sql` (referência em [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md))

---

## 3. Fluxo de execução (manual)

1. Criar **plano** (admin ou SQL) com `steps_json`.
2. Registrar **instância como mestre** (`master_instances`); a API admin valida `phone_number`.
3. **Start do job**: `lib/services/maturation/start-job.ts` (`runMaturationStart`) — escolhe mestre livre, cria job, expande plano em `maturation_steps`, trava `master_instances`, grava mensagens iniciais no feed.
4. **Tick**
   - `netlify/functions/maturation-tick.ts` (agendado, ex.: 1 min) chama `POST /api/maturation/cron-tick` com header `x-internal-cron-secret` = `CRON_SECRET`.
   - A rota (`app/api/maturation/cron-tick/route.ts`) pode executar `runMaturationTick` de forma assíncrona (`after()`), com `maxDuration` alto e modo sync opcional via env/header.
5. **`runMaturationTick`** (`lib/services/maturation/processor.ts`)
   - Reconcilia locks órfãos, recupera steps presos em `processing`, pode falhar jobs se o plano estiver inativo.
   - Loop: RPC `claim_maturation_steps` → para cada step, monta chamada à Evolution (`base_url` + credencial da instância) → envia → atualiza step e `maturation_messages` → atualiza progresso do job.
   - **Orçamento de tempo** (~50s) e **encadeamento** de ticks (`x-chain-depth`) se ainda houver passos pendentes.
   - **Espera ativa** curta se o próximo `scheduled_at` cai dentro do orçamento (planos com delays curtos não dependem só do cron de 1 min).
6. Em seguida: **`processVirginMaturation`** (auto virgem).

**Comportamentos importantes no processor**: `Connection Closed` pode pausar o job; rate limit / erros de gateway têm tratamento específico; steps “stuck” em `processing` são recuperados após timeout.

---

## 4. Agendamento automático de jobs (mestre)

- `netlify/functions/maturation-scheduler.ts` (ex.: a cada 10 min) identifica instâncias que precisam de maturação (health, tempo desde último job — variáveis `MATURATION_MIN_HEALTH_SCORE`, `MATURATION_MAX_HOURS_SINCE_LAST_JOB`) e cria jobs usando `MATURATION_DEFAULT_PLAN_ID` e o `default_target_chat_id` do plano.

---

## 5. APIs Next.js (visão geral)

- **App / usuário**: `app/api/maturation/*` — jobs, planos, master-instances, mensagens, `cron-tick`, `start`, `process-now`, instâncias virgem, etc.
- **Admin**: `app/api/admin/maturation/*` — mestres, upload de mídias virgem, etc.
- **Permissão de acesso à página**: `GET /api/maturation/can-access` — administradores “completos” **ou** cargo com item de sidebar `maturador` (tenant / `zaploto_roles`).

Lista detalhada de rotas: [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md).

---

## 6. Interface

| Rota | Descrição |
|------|-----------|
| `/maturador` | `app/maturador/page.tsx` — jobs, start/pause/abort, feed, planos, timer (`next_scheduled_at`), suporte a **malha** com `campaign_id`. |
| `/admin/maturador` | `app/admin/maturador/page.tsx` — abas: instâncias mestre, planos, mídias. |
| Admin geral | `components/Admin/MaturadorSection.tsx` (embed). |

---

## 7. Variáveis de ambiente

Ver tabela e exemplos em [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md). Em resumo: Supabase, `CRON_SECRET`, `MATURATION_*` (plano padrão, health, logs verbosos, tick sync, etc.).

---

## 8. O que levar para outra aplicação

1. **Padrão conceitual**: plano → job → steps agendados → worker idempotente → API WhatsApp (Evolution ou outro) → log/feed.
2. **Persistência**: tabelas equivalentes + mecanismo de **claim** (RPC com `SKIP LOCKED`, ou fila com consumo único).
3. **Worker**: cron + HTTP (como no Zaploto), ou fila (SQS, BullMQ, etc.). Aqui o envio é **HTTP direto à Evolution por step**, sem fila intermediária de mensagens.
4. **Escopo**: só “aquecimento de número” → foco no fluxo **virgem**; laboratório com sequências customizadas → **planos + jobs**.
5. **Bloqueio**: `master_instances.is_locked` e `evolution_instances.is_locked` / maturação virgem evitam usar o número em campanha durante a maturação.

### Arquivos de código principais

| Área | Caminho |
|------|---------|
| Doc operacional | `docs/MATURATION_SYSTEM.md` |
| Schema / RPC | `migrations/create_maturation_system.sql` |
| Tick + Evolution + virgem | `lib/services/maturation/processor.ts` |
| Start de job | `lib/services/maturation/start-job.ts` |
| Ciclo de vida (abort, virgem) | `lib/maturation/job-lifecycle.ts` |
| Cron HTTP | `app/api/maturation/cron-tick/route.ts` |
| Netlify | `netlify/functions/maturation-tick.ts`, `maturation-scheduler.ts`, `maturation-start.ts` |

---

*Última atualização: alinhado ao código e à documentação existente no repositório.*
