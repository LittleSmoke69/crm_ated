# Extração e sincronização de grupos WhatsApp (Evolution)

Documento de referência para entender **como a extração de grupos funciona hoje** no ZaplotoV2 e como **integrar outra aplicação** sem estourar timeout de edge/serverless (ex.: Netlify ~26s na rota Next).

---

## Visão geral

| Objetivo | Onde | Tempo típico de resposta HTTP |
|----------|------|-------------------------------|
| **Listar grupos já salvos** (cache no banco) | `GET /api/groups` | Milissegundos a poucos segundos |
| **Sincronizar com a Evolution** (lista completa da instância) | `POST /api/groups/fetch` | Ver modos abaixo |
| **Metadados/participantes de um grupo** | `POST /api/groups/extract-contacts` | Por grupo (uma chamada Evolution) |

A Evolution API costuma demorar **vários minutos** em instâncias com **centenas de grupos** ao pedir a lista completa. Isso **não cabe** em uma única requisição HTTP síncrona atrás do Netlify; a solução é **job assíncrono + polling** (ou usar só a lista em cache).

---

## Origem dos dados (Evolution)

A sincronização em lote usa o endpoint da Evolution:

- **Método:** `GET`
- **URL (conceito):** `{base_url}/group/fetchAllGroups/{instanceName}?getParticipants=false`
- **Header:** `apikey: <apikey da instância>`

`getParticipants=false` evita trazer todos os participantes de cada grupo (muito mais pesado). Participantes de **um** grupo são obtidos em rotas específicas (ex.: `extract-contacts` / `findGroupInfos`).

Implementação compartilhada: `lib/group-fetch/run-group-fetch-job.ts` → `fetchGroupsFromEvolution()`.

---

## Normalização e persistência

1. A resposta JSON da Evolution é normalizada em `normalizeEvolutionGroupsPayload()` (aceita array raiz, ou chaves `groups` / `data` / `result`, ou um único objeto).
2. Cada grupo vira: `id` (JID normalizado), `subject`, `pictureUrl`, `size`.
3. Persistência na tabela **`whatsapp_groups`** em lote: leitura dos existentes + inserts em chunks + updates com concorrência limitada (`persistWhatsappGroupsBatch()`).

---

## Modo síncrono (`POST /api/groups/fetch`)

Usado quando **não** entra no fluxo assíncrono da Netlify (ex.: desenvolvimento local sem `NETLIFY_DEV`, ou deploy sem variáveis do job).

- A rota **espera** a Evolution responder, persiste e devolve **no mesmo response** o array de grupos.
- Timeout configurado: `SYNC_FETCH_TIMEOUT_MS` (ordem de vários minutos) em `app/api/groups/fetch/route.ts`.
- **Problema em Netlify:** a camada que executa a API Route Next costuma cortar antes (~26s), gerando **504** se a Evolution demorar.

Arquivo: `app/api/groups/fetch/route.ts`.

---

## Modo assíncrono (Netlify + job no Supabase)

Ativado quando existem **`GROUP_FETCH_JOB_SECRET`** e detecção de runtime Netlify (`SITE_ID`, `NETLIFY_SITE_ID`, `NETLIFY`, `NETLIFY_DEV`, etc.), e **não** há `forceSync: true` no body.

Fluxo:

1. **`POST /api/groups/fetch`** com `{ "instanceName": "..." }`
2. Cria linha em **`group_fetch_jobs`** com `status: pending`.
3. Dispara a **Background Function** `groups-fetch-background` (header `x-group-fetch-secret`) com `{ jobId }`. O disparo é **não bloqueante** para a resposta HTTP: a API responde logo após criar o job, sem esperar o worker concluir o HTTP interno (evita atrasos de até ~12s e mantém a resposta em poucos segundos).
4. Resposta **`202 Accepted`** com corpo JSON padrão da API, por exemplo:
   - `data.jobId`
   - `data.async: true`
   - `data.message` com instrução de polling
   - Header **`Retry-After: 2`** (sugestão de intervalo para o cliente consultar o status)
5. Cliente faz **`GET /api/groups/fetch?jobId=...`** até `status` ser `completed` ou `failed`.
6. Com `completed`, a lista atualizada está em **`whatsapp_groups`**; o front usa `GET /api/groups?instanceName=...&evolutionShape=1` para o formato “Evolution”.

Worker que executa o job: `netlify/functions/groups-fetch-background.ts` → `claimGroupFetchJob` + `executeGroupFetchJob` (timeout longo na chamada à Evolution: `EVOLUTION_GROUP_FETCH_TIMEOUT_MS`).

**Fallback:** `netlify/functions/process-group-fetch-jobs.ts` (cron agendado) reinvoca o background ou, em casos limitados, tenta execução direta com timeout curto na Evolution.

Cliente de referência (browser): `lib/utils/group-fetch-client.ts` → `postGroupFetchAndResolve()` (polling a cada 2s por padrão).

---

## Listagem rápida (sem esperar a Evolution)

Para a outra aplicação mostrar grupos **em segundos** (ou menos):

- **`GET /api/groups?instanceName=<nome>`** — lista do cache (`group_id`, `group_subject`).
- **`GET /api/groups?instanceName=<nome>&evolutionShape=1`** — mesmo cache no formato `{ id, subject, pictureUrl, size }`.

Fluxo recomendado na UI/outro app:

1. Mostrar imediatamente o que está no banco (`GET /api/groups`).
2. Opcional: botão “Atualizar da Evolution” → `POST /api/groups/fetch` → polling do job → atualizar tela com novo `GET`.

Assim o usuário **não fica** com conexão aberta minutos na primeira tela.

---

## Autenticação

As rotas usam `requireAuth` (cookie/sessão conforme middleware). O cliente interno envia também `X-User-Id` onde aplicável; na integração externa, replique o mesmo contrato de auth do projeto.

---

## Variáveis de ambiente relevantes

| Variável | Papel |
|----------|--------|
| `GROUP_FETCH_JOB_SECRET` | Segredo compartilhado entre API e `groups-fetch-background` |
| `SITE_ID` / `NETLIFY_SITE_ID` | Ajuda a detectar runtime Netlify para modo assíncrono |
| `URL` / `SITE_URL` | URL do site para montar `/.netlify/functions/...` |
| `NETLIFY_FUNCTIONS_URL` / `NEXT_PUBLIC_NETLIFY_FUNCTIONS_URL` | Base opcional explícita das functions |
| Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | Jobs e tabela `whatsapp_groups` |

---

## Contrato resumido para integração externa

```http
# 1) Lista imediata (cache)
GET /api/groups?instanceName=minha-instancia
Authorization: <mesmo esquema do app>

# 2) Pedir sincronização (assíncrono na Netlify com secret configurado)
POST /api/groups/fetch
Content-Type: application/json
{ "instanceName": "minha-instancia" }
# → 202 + { "data": { "jobId": "uuid", "async": true, ... } }

# 3) Polling
GET /api/groups/fetch?jobId=<uuid>

# 4) Após completed — lista no formato UI
GET /api/groups?instanceName=minha-instancia&evolutionShape=1
```

---

## Melhoria aplicada (tempo da primeira resposta)

- **Antes:** `POST /api/groups/fetch` (modo assíncrono) **aguardava** até ~12s o `fetch` de disparo do worker.
- **Agora:** o job é criado e a API responde **202** em pouco tempo; o disparo do worker roda em **segundo plano** (sem bloquear). Falhas no disparo continuam recuperáveis pelo cron `process-group-fetch-jobs`.

---

## Referências de código

- `app/api/groups/fetch/route.ts` — POST/GET fetch, escolha sync/async, disparo do worker
- `lib/group-fetch/run-group-fetch-job.ts` — Evolution + persistência + execução do job
- `lib/utils/group-fetch-client.ts` — polling no front
- `app/api/groups/route.ts` — listagem e salvamento pontual
- `netlify/functions/groups-fetch-background.ts` — worker longo
- `netlify/functions/process-group-fetch-jobs.ts` — cron / fallback
- `app/api/groups/extract-contacts/route.ts` — um grupo (ex.: participantes)

---

*Última atualização: documentação alinhada ao código em 2026-04-06 (resposta 202 + trigger não bloqueante).*
