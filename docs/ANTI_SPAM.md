# Módulo Anti-Spam (Real Time)

Anti-Spam em tempo real consumindo eventos de webhook gravados em `evolution_webhook_events`.

## Banco de dados

- **Migration:** `migrations/create_anti_spam_tables.sql`
- Tabelas: `anti_spam_configs`, `anti_spam_groups`, `anti_spam_blacklist`, `anti_spam_event_cursor`, `anti_spam_actions`

## Worker

- **Entrada:** `scripts/anti-spam-worker.ts`
- **Lógica:** `lib/anti-spam/antiSpamWorker.ts`
- **Execução:** `npm run anti-spam:worker` ou PM2: `pm2 start "npx tsx scripts/anti-spam-worker.ts" --name anti-spam-worker`

### Variáveis de ambiente (opcional)

| Variável | Descrição | Default |
|----------|-----------|---------|
| `ANTI_SPAM_POLL_MS` | Intervalo de polling (ms) | 800 |
| `ANTI_SPAM_BATCH_SIZE` | Eventos por lote | 50 |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase | obrigatório |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role | obrigatório |

## API Admin (RBAC: super_admin, admin, auditoria)

- `GET /api/admin/anti-spam/config?banca_id=...` — lista configs da banca
- `POST /api/admin/anti-spam/config` — criar/atualizar config
- `GET /api/admin/anti-spam/blacklist?config_id=...` — lista blacklist
- `POST /api/admin/anti-spam/blacklist/add` — adicionar número
- `POST /api/admin/anti-spam/blacklist/remove` — remover número
- `GET /api/admin/anti-spam/actions?config_id=...&from=...&to=...` — logs paginados
- `GET /api/admin/anti-spam/stats?config_id=...&banca_id=...` — métricas (removidos/falhas hoje, top grupos)
- `POST /api/admin/anti-spam/test-run` — executa um ciclo do worker (teste)

## UI

- **Página:** `/admin/anti-spam`
- Blocos: Config (toggle, instância mestre/watcher, grupo denúncia, scan_mode), Grupos monitorados, Blacklist, Logs/Ações.

## Fluxo

1. **group-participants.update (action: add):** Se participante está na blacklist ativa, remove do grupo via Evolution API (instância mestre).
2. **messages.upsert no grupo de denúncia:** Extrai telefones do texto, insere/atualiza blacklist com `reason=denuncia_grupo`.
3. Idempotência: cada ação é registrada em `anti_spam_actions` com chave em `meta.action_key`; reprocessamento não duplica ações.

## Evolution API

- Cliente: `lib/anti-spam/evolution-client.ts`
- Rate limit: 1 ação/segundo por instância.
- Retry: 3 tentativas com backoff.
- Credenciais: resolvidas por `evolution_instances` + `evolution_apis` (base_url, apikey da instância ou api_key_global).
