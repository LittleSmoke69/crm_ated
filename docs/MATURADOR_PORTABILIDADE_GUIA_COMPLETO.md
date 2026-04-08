# Maturador ZaplotoV2 — guia técnico completo para portabilidade

Documento **autocontido** com a visão detalhada de como o maturador funciona no código e no banco, para **implementar ou adaptar em outra aplicação**.  

**Documentos relacionados**

- [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md) — variáveis de ambiente, cron no `netlify.toml`, troubleshooting, buckets de storage.
- [MATURADOR_ARQUITETURA_E_PORTABILIDADE.md](./MATURADOR_ARQUITETURA_E_PORTABILIDADE.md) — resumo compacto da mesma arquitetura.

---

## 1. O que o sistema faz (dois modos)

### 1.1 Maturador manual (instâncias **mestre**)

- **Planos** (`maturation_plans`) definem uma sequência de passos em JSON: texto, vídeo; na UI/admin também aparecem imagem e áudio em alguns fluxos.
- Cada execução vira um **job** (`maturation_jobs`) associado a:
  - **Dono** (`owner_user_id` em `profiles`),
  - **Plano** (`plan_id`),
  - **Instância mestre** (`master_instances` → `evolution_instances`),
  - **Chat alvo** (`target_chat_id`, ex.: grupo `...@g.us` ou número).
- Os passos são **expandidos** em linhas (`maturation_steps`) com `scheduled_at` calculado a partir do início do job e dos `delaySec` entre passos.
- Um **worker periódico** (tick) **reivindica** passos cuja hora já passou, chama a **Evolution API** de forma direta (`sendText`, `sendMedia`, `sendWhatsAppAudio`) e grava resultado (status, latência, HTTP, erro).
- A interface consome um **feed estilo WhatsApp** (`maturation_messages`).

Não há fila de mensagens intermediária entre o worker e a Evolution: cada step é um (ou poucos) HTTP(s) diretos.

### 1.2 Auto maturador **virgem** (cerca de 5 dias)

- Na tabela `evolution_instances`, `maturation_type` pode ser `virgem` ou `maturado`.
- Se for **virgem**, depois de conectar (QR), a instância entra numa **máquina de estados** (`maturation_status`: teste de conexão, conversas 1:1, grupo, posting de status, ciclo repetido nos dias seguintes, etc.).
- Enquanto isso, a instância fica **bloqueada** para uso “normal” (campanhas, fluxos), conforme regras do app.
- O **mesmo** `runMaturationTick` que processa jobs manuais chama `processVirginMaturation()` em `lib/services/maturation/processor.ts`, que:
  - avança fases conforme o tempo decorrido;
  - dispara envios configuráveis (texto, mídia com URLs assinadas do bucket `virgin-maturation-media`).
- Tabelas auxiliares: `virgin_maturation_groups`, `virgin_maturation_logs`.
- O plano lógico do auto-maturador usa um id fixo simbólico: `VIRGIN_AUTO_MATURATION_PLAN_ID` (`a0000000-0000-0000-0000-000000000001`) em `lib/maturation/job-lifecycle.ts`, usado ao abortar jobs automáticos e pausar instância virgem.

---

## 2. Modelo de dados (Supabase)

| Tabela / objeto | Papel |
|-----------------|--------|
| `master_instances` | Liga `evolution_instances` ao papel de “mestre”; `is_locked` / `locked_job_id` impedem dois jobs simultâneos na mesma instância; `health_score`, `last_seen_at`. |
| `maturation_plans` | Nome, `steps_json`, `default_target_chat_id`, `is_active`, etc. |
| `maturation_jobs` | Uma execução: `status` (`queued`, `running`, `paused`, `finished`, `failed`, `aborted`), progresso, datas, `target_chat_id`. |
| `maturation_steps` | Cada passo: `step_index`, `type`, `payload_json`, `scheduled_at`, `status` (`pending`, `processing`, `sent`, `failed`, `skipped`), tentativas, erros. |
| `maturation_messages` | Feed para UI (`direction`: system / instance; tipos text, video, info, error, retry). |
| `evolution_instances` (colunas virgem) | `maturation_type`, `maturation_status`, janelas de tempo, `current_day`, `is_locked`, `maturation_paused_at`, … |
| RPC `claim_maturation_steps` | Atualização atômica com `FOR UPDATE SKIP LOCKED`: só um worker “pega” cada step; marca `processing` e `locked_by`. |

**Migrations de referência**

- `migrations/create_maturation_system.sql` — tabelas core + RPC + triggers.
- `migrations/add_virgin_maturation_to_evolution_instances.sql` — estado virgem + grupos + logs.
- Bucket de mídia do fluxo virgem: ver [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md) e migration `create_virgin_maturation_media_bucket.sql`.

---

## 3. Fluxo de execução (manual), passo a passo

1. Criar **plano** (painel admin `/admin/maturador` ou SQL) com `steps_json` válido.
2. Incluir instância em **`master_instances`**; a API admin exige `phone_number` na `evolution_instance`.
3. **Iniciar job**: `runMaturationStart` em `lib/services/maturation/start-job.ts` — escolhe mestre disponível, cria `maturation_jobs`, materializa `maturation_steps`, trava `master_instances`, registra mensagens iniciais.
4. **Agendador do tick**
   - Em produção típica (Netlify): `netlify/functions/maturation-tick.ts` roda em cron (~1 min).
   - A função chama `POST {SITE_URL}/api/maturation/cron-tick` com header `x-internal-cron-secret: CRON_SECRET`.
5. **Rota** `app/api/maturation/cron-tick/route.ts`
   - Valida secret; pode rodar o processamento em **segundo plano** (`after()`) para não estourar timeout de proxy; `maxDuration` alto; modo síncrono opcional (`MATURATION_CRON_TICK_SYNC` ou header).
   - Se após o tick ainda houver passos pendentes por **limite de tempo**, pode **encadear** outro tick (`x-chain-depth`, limite máximo) para não esperar só o próximo minuto.
6. **`runMaturationTick`** (`lib/services/maturation/processor.ts`)
   - `reconcileOrphanedMasterInstanceLocks`, recuperação de steps presos em `processing` (timeout), invalidação de jobs com plano inativo, etc.
   - Loop principal: `claim_maturation_steps` → envio Evolution por step → atualização de `maturation_steps` e `maturation_messages` → `updateJobProgress`.
   - **Orçamento** de ~50s por tick; se o próximo `scheduled_at` cair **dentro** do orçamento, o tick pode **esperar** alguns segundos e tentar de novo (útil para planos com delays curtos entre mensagens).
7. Ao final do manual: **`processVirginMaturation`** para instâncias virgem.

**Erros e resiliência (resumo)**

- Mensagens tipo “Connection Closed” podem levar o job a **pausado** (evitar tempestade de retries).
- Rate limit / 5xx da Evolution ou gateway têm ramos específicos no processor.
- Steps que ficam eternamente em `processing` são **revertidos** para `pending` após timeout configurável.

---

## 4. Idempotência e retry (manual)

- **Idempotência**: garantida pelo RPC `claim_maturation_steps` + estado `processing` / `locked_by`, para que dois workers não enviem o mesmo step.
- **Retry**: steps que falham são reagendados com backoff (ordem de minutos crescentes); após `max_attempts` o step vai para `failed`. Detalhes em [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md).

---

## 5. Agendamento automático de novos jobs (mestre)

- `netlify/functions/maturation-scheduler.ts` (ex.: a cada 10 min) lista instâncias que “precisam” maturação (critérios ligados a `MATURATION_MIN_HEALTH_SCORE`, `MATURATION_MAX_HOURS_SINCE_LAST_JOB`).
- Usa `MATURATION_DEFAULT_PLAN_ID` e o `default_target_chat_id` do plano para criar jobs automaticamente.

---

## 6. Outras peças de infraestrutura

| Peça | Função |
|------|--------|
| `netlify/functions/maturation-start.ts` | POST delegando para a mesma lógica de start de job (útil quando o cliente chama a function em vez da API Next). |
| `GET /api/maturation/can-access` | Libera `/maturador` para admin completo ou cargo com item de sidebar `maturador` (tenant). |
| `app/api/maturation/*` | Jobs, planos, mensagens, `start`, `process-now`, instâncias virgem, etc. |
| `app/api/admin/maturation/*` | Mestres, uploads de mídia virgem, etc. |

Lista de rotas e envs: [MATURATION_SYSTEM.md](./MATURATION_SYSTEM.md).

---

## 7. Interface no app

| Rota | Arquivo / notas |
|------|------------------|
| `/maturador` | `app/maturador/page.tsx` — lista de jobs, controles, feed, planos, `next_scheduled_at`, campanhas com **malha** (`campaign_id`). |
| `/admin/maturador` | `app/admin/maturador/page.tsx` — instâncias mestre, planos, mídias. |
| Bloco no admin | `components/Admin/MaturadorSection.tsx` |

---

## 8. Checklist para implementar em outra aplicação

1. **Modelo mental**: plano → job → steps com horário → worker idempotente → API WhatsApp → log para UI.
2. **Persistência**: tabelas equivalentes; obrigatório um **claim atômico** (Postgres `SKIP LOCKED`) ou **fila** com consumo único (SQS, BullMQ, etc.).
3. **Worker**: cron disparando HTTP (como aqui) ou fila dedicada; separar **limite de tempo** do worker e **encadeamento** se houver muitos steps.
4. **Escopo mínimo**: só aquecimento automático → implementar só fluxo **virgem**; laboratório customizado → **planos + jobs + feed**.
5. **Segurança operacional**: bloquear instância em campanha enquanto `is_locked` / maturação ativa.
6. **Secrets**: nunca expor `CRON_SECRET` ou service role no cliente; tick só server-side.

---

## 9. Arquivos de código principais

| Área | Caminho |
|------|---------|
| Documentação operacional | `docs/MATURATION_SYSTEM.md` |
| Resumo arquitetura | `docs/MATURADOR_ARQUITETURA_E_PORTABILIDADE.md` |
| Schema + RPC | `migrations/create_maturation_system.sql` |
| Tick, Evolution, virgem | `lib/services/maturation/processor.ts` |
| Criação de job / start | `lib/services/maturation/start-job.ts` |
| Abort / plano virgem | `lib/maturation/job-lifecycle.ts` |
| Delay mínimo entre steps (UI/API) | `lib/maturation/min-step-delay.ts` |
| API do cron | `app/api/maturation/cron-tick/route.ts` |
| Netlify | `netlify/functions/maturation-tick.ts`, `maturation-scheduler.ts`, `maturation-start.ts` |

---

*Documento gerado para consolidar a explicação técnica do maturador com foco em portabilidade. Alinhar sempre com o código e com MATURATION_SYSTEM.md em caso de evolução.*
