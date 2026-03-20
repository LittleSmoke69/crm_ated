# Nó Pergunta — cron de “Tempo esgotado”

O ramo **Tempo esgotado** depende de processar pendências em `flow_question_pending` quando `expires_at` passou.

## Recomendado: verificação **a cada 1 segundo**

- **Endpoint:** `GET` ou `POST`  
  `/api/internal/cron/flow-question-timeouts?token=<CRON_SECRET>`  
  ou header `Authorization: Bearer <CRON_SECRET>`  
  (`CRON_SECRET` ou `INTERNAL_CRON_SECRET`)

### Opção A — Processo Node único (Docker / PM2 / VPS)

```env
FLOW_QUESTION_POLL_ENABLED=true
FLOW_QUESTION_POLL_INTERVAL_MS=1000
URL=https://seu-dominio.com
CRON_SECRET=...
```

O arquivo `instrumentation.ts` dispara o endpoint no intervalo configurado (mínimo 1000 ms).

**Não use** em várias réplicas serverless sem coordenação (cada instância faria polling).

### Opção B — Cron externo (qualquer host)

Exemplo (a cada 1 segundo):

```bash
while true; do
  curl -sS "https://SEU_DOMINIO/api/internal/cron/flow-question-timeouts?token=SEU_CRON_SECRET" > /dev/null
  sleep 1
done
```

### Opção C — Netlify Scheduled Function

`netlify/functions/flow-question-timeouts.ts` + `netlify.toml` com `schedule = "*/1 * * * *"` → no máximo **~1 minuto** (limite da plataforma), não substitui 1 segundo.

---

Variáveis relacionadas: `CRON_SECRET`, `INTERNAL_CRON_SECRET`, `URL` / `SITE_URL` / `NEXT_PUBLIC_SITE_URL`.
