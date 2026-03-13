# Formação automática: resolução de transferências expiradas

## Visão geral

Transferências de leads têm um **prazo em dias** (ex.: 10 dias). Após o prazo:

- **Resolver** = comparar dados atuais dos leads no CRM com o snapshot da transferência:
  - Se o lead depositou ou apostou mais → **vinculado** (fica com o consultor destino).
  - Caso contrário → **disponível para retransferência** (pode ser movido para outro consultor).

A **formação automática** executa essa resolução a cada **30 minutos** para todas as transferências expiradas que ainda tenham entries com `resolution_status = 'pending'`.

## Componentes

### 1. API – listar expiradas

- **GET** `/api/admin/crm/transfer-logs/expired`
- Query: `banca_id?` (opcional).
- Retorna lista de logs expirados que ainda têm leads pendentes de resolução.

### 2. API – resolver em lote (admin)

- **POST** `/api/admin/crm/transfer-logs/resolve-batch`
- Body: `{ banca_id?: string, log_ids?: string[] }`
- Exige autenticação de admin.
- Retorno: `results[]`, `total_resolved`, `total_vinculado`, `total_disponivel`.

### 3. API – cron (formação automática)

- **POST** `/api/cron/resolve-expired-transfers`
- Header obrigatório: **X-Cron-Secret** = valor de `TRANSFER_RESOLVE_CRON_SECRET`.
- Não usa sessão de usuário; destinada a agendamento (Netlify, cron externo, etc.).
- Resolve todas as transferências expiradas com entries pendentes.

### 4. Netlify scheduled function

- **Função:** `transfer-resolve-expired`
- **Agendamento:** a cada 30 minutos (`*/30 * * * *`).
- Chama `POST /api/cron/resolve-expired-transfers` com o header `X-Cron-Secret`.

## Configuração

### Variáveis de ambiente

- **TRANSFER_RESOLVE_CRON_SECRET**  
  Define o segredo para autorizar a rota de cron. Deve ser o mesmo valor usado pela função agendada (ou por qualquer cliente que chame a API de cron).
  - No **Netlify**: em *Site settings → Environment variables*, defina `TRANSFER_RESOLVE_CRON_SECRET` com um valor seguro.
  - Em **dev local**: opcional; se não estiver definido, a rota `/api/cron/resolve-expired-transfers` retorna 501.

### Netlify

O agendamento já está em `netlify.toml`:

```toml
[functions."transfer-resolve-expired"]
  schedule = "*/30 * * * *"
```

Não é necessário alterar nada além da variável `TRANSFER_RESOLVE_CRON_SECRET`.

### Cron externo (alternativa)

Se não usar Netlify Functions, pode agendar um **cron** (ex.: a cada 30 min) para chamar:

```bash
curl -X POST "https://seu-dominio.com/api/cron/resolve-expired-transfers" \
  -H "X-Cron-Secret: SEU_SEGREDO"
```

Use o mesmo valor definido em `TRANSFER_RESOLVE_CRON_SECRET`.

### Testar com netlify dev

Para rodar o ambiente igual ao da Netlify e disparar a function manualmente:

1. **Variáveis de ambiente**  
   No `.env` (ou no painel do Netlify se o site estiver linkado), defina:
   ```env
   TRANSFER_RESOLVE_CRON_SECRET=seu_segredo
   ```
   O `netlify dev` carrega o `.env` automaticamente.

2. **Subir o ambiente**  
   Em um terminal:
   ```bash
   netlify dev
   ```
   O site e as functions sobem juntos (ex.: `http://localhost:8888`). A variável `URL` é preenchida com essa base.

3. **Disparar a function manualmente**  
   Em **outro** terminal (com o `netlify dev` ainda rodando):
   ```bash
   netlify functions:invoke transfer-resolve-expired
   ```
   A saída mostra o mesmo retorno que a function teria no servidor (status, body com `resumo_por_pacote`, `vinculados`, `banca_name`, etc.).

4. **Ver o log completo**  
   O body vem em JSON; para formatar:
   ```bash
   netlify functions:invoke transfer-resolve-expired | jq .
   ```
   (Requer [jq](https://jq.sh/) instalado; sem `jq`, o JSON já vem no stdout.)

5. **Timeout ao invocar**  
   O `netlify functions:invoke` usa um timeout (ex.: 30s). Se aparecer *"Task timed out after 30.00 seconds"*, a function está processando muitos pacotes/leads. Cada pacote faz várias chamadas ao CRM (uma por lead). Para teste local rápido, use poucas entries por pacote:
   ```bash
   TRANSFER_RESOLVE_MAX_ENTRIES=2 netlify functions:invoke transfer-resolve-expired
   ```
   A function usa por padrão 3 entries por pacote; com `TRANSFER_RESOLVE_MAX_ENTRIES=2` cada requisição à API termina em segundos e o invoke tende a completar dentro do timeout.

Assim você testa a function no mesmo contexto do Netlify (URL local, env e resposta iguais ao deploy).

## Fluxo na UI (Admin)

1. **Histórico e conversão**  
   O admin pode:
   - Clicar em **Resolver transferências expiradas** (ou equivalente) para chamar `resolve-batch` manualmente.
   - Ver o **relatório em azul** (antes/depois, quantos vinculados, quantos para mover).
   - Na tabela de leads do modal, ver **slot (TF/TF1/TF2/TF3)** e **consultor doador**.
   - Em **Mover para próximo**, usar o mesmo modal de confirmação com dropdown de tipo (TF/TF1/TF2/TF3) e confirmar.

2. **Solicitações**  
   A lista de solicitações de leads possui **paginação** para não carregar tudo de uma vez.

## Referências

- Resolução de uma transferência: `lib/server/crm/resolveTransferLog.ts`
- Resolve único: `POST /api/admin/crm/transfer-logs/resolve`
- Resolve em lote: `POST /api/admin/crm/transfer-logs/resolve-batch`
- Cron: `POST /api/cron/resolve-expired-transfers`
- Netlify: `netlify/functions/transfer-resolve-expired.ts`
