# Limpeza de Lista (List Cleaning)

Feature para aumentar a assertividade na limpeza de contatos: deduplicação + validação de WhatsApp via **Wasender API**.

## Funcionalidades

- **Upload**: textarea (um número por linha) ou arquivo CSV/TXT com coluna `phone`. Máximo 1000 números por execução.
- **Deduplicação**: removida antes da verificação; métricas: total_raw, total_unique, duplicates_removed.
- **Verificação WhatsApp**: Wasender API `GET /api/on-whatsapp/{phone}`; status por número: active / inactive / unknown. **Números duplicados não entram na verificação** (apenas itens com `is_duplicate = false` são enviados à API).
- **Verificação em slots**: cada execução processa no máximo 10 números (delay 1,2–1,5 s entre cada), ~20 s por slot, evitando timeout no Netlify. O scheduler continua os próximos slots a cada 1 minuto.
- **Download**: CSV com coluna `phone` (apenas validados). Parcial (500) ou total (1000).

## Tabelas Supabase

Executar as migrations:

```bash
# migrations/create_list_cleaning_tables.sql
# migrations/create_list_cleaning_verification_runs.sql
```

- **list_cleaning_jobs**: jobs do usuário (status, totais).
- **list_cleaning_items**: itens por job (phone, is_duplicate, whatsapp_status, verified_at, raw_payload).
- **list_cleaning_verification_runs**: um registro por job em verificação; status `pending` \| `running` \| `completed` \| `error`; progresso em `processed_numbers` / `total_numbers`; o scheduler processa um slot por vez.

## Variáveis de ambiente

Para a verificação WhatsApp (Wasender API), defina no ambiente (backend e Netlify functions):

- **WASENDER_API_KEY**: token Bearer da Wasender API. Coloque apenas em `.env` (nunca commitar).
- O delay entre uma verificação e outra é **aleatório entre 1,2 s e 1,5 s** por número; cada slot processa no máximo **10 números** (~20 s por execução).

Também usadas:

- **NEXT_PUBLIC_SUPABASE_URL** / **NEXT_PUBLIC_SUPABASE_ANON_KEY**: já existentes.
- **SUPABASE_SERVICE_ROLE_KEY**: usada nas APIs e na Netlify function `list-cleaning-resume`.

## Wasender API

- **Endpoint**: `GET https://www.wasenderapi.com/api/on-whatsapp/{phone}` — o número é enviado com prefixo `+` (ex.: `+5511999999999`).
- **Header**: `Authorization: Bearer {{WASENDER_API_KEY}}`
- **Resposta esperada**: `{ success: true, data: { exists: true | false } }`
  - `data.exists === true` → número **válido** no WhatsApp (status `active`).
  - `data.exists === false` → número **não válido** (status `inactive`).
  - Resposta sem `data.exists` ou erro de rede → tratado como `unknown` (não se marca como inactive para não perder leads).
- Logs: o sistema registra cada verificação (phone mascarado, status) e resumos de lote para acompanhamento.

## Scheduler (Netlify)

A function `list-cleaning-resume` roda a cada 1 minuto (configurada em `netlify.toml`). Ela:

1. Busca **list_cleaning_verification_runs** com `status = 'running'` (até 3 runs por invocação).
2. Para cada run, processa **um slot** (até 10 números) com delay 1,2–1,5 s entre números.
3. Atualiza `processed_numbers`, contagens do job e, ao concluir todos, marca o run e o job como `completed` / `done`.

Requer: `NEXT_PUBLIC_SUPABASE_URL` (ou `SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` e `WASENDER_API_KEY`.

## Rotas da API

- `POST /api/list-cleaning`: cria job (body: `rawText` ou `phones`); deduplicação feita no backend.
- `GET /api/list-cleaning`: lista jobs do usuário.
- `GET /api/list-cleaning/[jobId]`: detalhe do job + rawList + cleanList.
- `POST /api/list-cleaning/[jobId]/verify`: cria/reabre um run e processa **um slot** (até 10 números); retorna rápido; o scheduler continua os demais slots.
- `POST /api/list-cleaning/[jobId]/stop`: para a verificação e marca o job como concluído; números já verificados ficam disponíveis para download.
- `GET /api/list-cleaning/[jobId]/download?limit=500|1000`: CSV com coluna `phone` (apenas validados).
- `POST /api/whatsapp/check`: verifica um número (body: `{ phone }`). Retorno: `{ phone, on_whatsapp, source: "wasender", checked_at }`. Uso em outros fluxos (ex.: antes de addGroupParticipant).

## Segurança

- Nunca logar WASENDER_API_KEY em console.
- Coloque o token apenas em `.env`; revogue e crie novo se tiver sido exposto.
- Payload raw da API armazenado em `raw_payload` (jsonb); exibição apenas em contexto admin/debug se necessário.
