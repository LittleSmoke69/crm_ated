# Integração Meta Ads (Facebook/Instagram)

Integração com Meta Graph API para alimentar o Gestor de Tráfego com métricas de campanhas (alcance, impressões, cliques, leads, spend).

## Configuração

### Variáveis de ambiente

- `ENCRYPTION_PEPPER`: Chave usada para criptografar o token da Meta no banco. Configure em produção.
- O token é armazenado criptografado em `meta_integrations.access_token_encrypted`.
- **Logs Meta (opcional, só diagnóstico):** em produção os logs verbosos ficam **desligados**. Para depurar, use `LOG_META_DEBUG=1` (ou legado `LOG_META_ADS_HIERARCHY=1`). **Não** deixe essas flags ativas em prod — geram muito `JSON.stringify` a cada request da Meta.

### Migração

Executar no Supabase:

```bash
# Aplicar migração
psql $DATABASE_URL -f migrations/create_meta_ads_tables.sql
```

## Fluxo

1. **Admin** configura em `/admin/meta`:
   - Base URL (default: https://graph.facebook.com/v19.0)
   - Access Token (System User)
   - Ad Account ID (act_xxx)
   - Pixel ID
   - Campanha padrão (opcional)

2. **Testar conexão** valida `/me` e `/me/adaccounts`.

3. **Sincronizar agora** popula `meta_campaigns`, `meta_adsets`, `meta_insights_daily`.

4. **Gestor de Tráfego** (`/gestor-trafego`) exibe o funil 3D unificado:
   - Alcance, Impressões, Cliques, Leads (Meta)
   - Cadastros, Depósitos, Ativos (Loteria)

## Atribuição de consultores por redirect

- Descrição: campanhas Meta também podem ser associadas aos consultores a partir dos grupos de redirect. O vínculo nasce em `redirect_groups.consultant_user_id` e a campanha é inferida por `redirect_clicks.utm_campaign`, comparando com `meta_campaigns.campaign_id` ou `meta_campaigns.name`.
- Justificativa: alinhar gasto de ads com o consultor/grupo que recebeu o tráfego, refletindo em `/admin/meta` e no card de gasto de ads de `/consultor`.
- Impactos: o redirect agora preserva `utm_campaign`/`fbclid` mesmo quando não há sessão VSL (`sid`); `meta_campaign_consultors` continua aceitando atribuição manual e as leituras somam manual + redirect inferido. A tela de redirect também expõe `vsl_projects.banca_id`, `owner_user_id` e gestores vinculados à banca para auditar quem criou/usa o redirect e qual banca carrega o spend.
- Vínculo manual: a coluna **Redirect** em `/admin/meta` persiste `meta_campaigns.redirect_project_id` (`migrations/add_redirect_project_to_meta_campaigns.sql`). A tela do redirect soma o spend sincronizado em `meta_insights_daily` das campanhas vinculadas e mostra o billing da conta Meta da banca para fechar `ads + redirect + consultor`.
- Data/responsável: 2026-04-29 / Cursor.

## Métricas financeiras

A Meta expõe três conceitos financeiros distintos que **não são intercambiáveis**:

| Métrica | Origem (Graph API) | Significado |
| --- | --- | --- |
| `spend` (Spend Insights) | `/act_{id}/insights` em nível de campanha | Custo estimado das campanhas no período filtrado. Não inclui impostos/ajustes posteriores. |
| `balance_due` (Balance pendente) | `/act_{id}?fields=amount_spent,balance,spend_cap,currency,timezone_name` | Valor pendente que ainda **não foi cobrado** no método de pagamento — vai sendo acumulado até bater o threshold/data de fechamento. |
| `total_card_charges` (Cobrado no cartão) | `/act_{id}/activities` filtrando `event_type=ad_account_billing_charge` (param `category=ACCOUNT_BILLING_CHARGE`) | Cobranças efetivas no método de pagamento (cartão) **no período do filtro**. É o valor que aparece na fatura do cartão. |

### Por que `balance` ≠ valor da fatura?

`balance` é apenas o saldo pendente atual. Quando a Meta atinge o limite de cobrança (threshold) ou data de fechamento, ela **debita o cartão** e zera/abate o `balance`. Logo:

- Fatura de cartão R$ 1.506 (cobrança que já aconteceu) → vem da soma de `ad_account_billing_charge` no período.
- `balance` R$ 104 (pendente para próxima cobrança) → ainda não virou cobrança.
- `amount_spent` (lifetime) → total acumulado da conta desde sempre, inclui o que já foi cobrado e o que está pendente.

### Endpoint deprecado

O endpoint legado `/act_{id}/transactions` foi descontinuado pela Meta. A alternativa oficial é a edge `activities` filtrando por `event_type=ad_account_billing_charge`. O sistema usa a função `getAdAccountBillingCharges(baseUrl, token, adAccountId, since, until)` em `lib/meta/metaClient.ts`.

### Aderência das APIs internas

- `lib/services/meta-sync-service.ts` → `fetchMetaBillingSnapshot(baseUrl, token, adAccountId, { cardChargesPeriod })` busca em paralelo `getAccountFinance` (balance/amount_spent) **e** `getAdAccountBillingCharges` (cobranças efetivas no cartão), ambos com o mesmo período do filtro do painel.
- `summarizeMetaBillingSnapshots` deduplica por `ad_account_id` antes de somar `total_balance_due`, `total_amount_spent` **e** `total_card_charges` (assim a mesma conta Meta vinculada a múltiplas bancas/integrações não é contada duas vezes).
- Rotas que retornam billing: `/api/admin/meta/active-campaigns-spend` (snapshot da banca), `/api/admin/meta/consolidated-active-campaigns-spend` (todas as integrações), e os streams `/api/admin/meta/live-aggregate-stream` / `/api/admin/meta/live-aggregate` (painel admin em tempo real).

## Multi-moeda (Ad Accounts em USD/EUR)

Cada Ad Account na Meta tem uma única moeda configurada (`currency` em `getAccountFinance`). Quando uma campanha pertence a uma Ad Account em USD, o `spend` retornado pelo `/insights` **vem em USD** — somar diretamente com BRL geraria total inválido.

### Estratégia adotada

- `lib/services/exchange-rate-service.ts` busca a cotação USD-BRL na **AwesomeAPI** (`https://economia.awesomeapi.com.br/last/USD-BRL`), com cache em memória de 10 min e coalescência de chamadas concorrentes.
- Fallback configurável via `EXCHANGE_RATE_USD_BRL_FALLBACK` (default 5.0) em caso de falha temporária.
- Cada `AdminMetaLiveCampaignRow` agora tem:
  - `currency`: moeda da Ad Account (ex.: `BRL` ou `USD`).
  - `spend`: valor original na moeda da conta.
  - `spend_brl`: valor convertido para BRL (BRL ⇒ permanece igual; USD ⇒ multiplica pela cotação).
- Os totais (`AdminMetaLiveAggregateResult.totals.spend`, `spend_bolao`) consolidam sempre em BRL via `spend_brl`. As linhas exibem o valor original e a conversão estimada.
- O resultado expõe `exchange_rates` com a(s) cotação(ões) usada(s), incluindo `source` (`awesomeapi` / `cache` / `fallback`) para rastreabilidade no painel.

### Override manual de moeda por campanha

Quando a Meta não devolve a moeda corretamente (ou queremos forçar a interpretação para corrigir lançamentos antigos), o admin pode sobrescrever a moeda **por campanha** direto no painel.

- Persistência: `meta_campaigns.currency_override` (`BRL | USD | NULL`). `NULL` ⇒ usar a moeda nativa da Ad Account.
- Migration: `migrations/add_currency_override_to_meta_campaigns.sql` (CHECK constraint impede valores diferentes de BRL/USD).
- API: `POST /api/admin/meta/campaign-currency` aceita `{ banca_id, campaign_id, currency: 'BRL' | 'USD' | null, name? }`. Faz upsert em `meta_campaigns` (mesmo padrão de `campaign-kind`).
- Backend (`processAdminMetaLiveJob`): lê `currency_override` junto com `campaign_kind` no mesmo SELECT, monta `currencyOverrideByBancaCampaign` e usa como prioridade 1 ao decidir `currency` da linha. `spend_brl` é recalculado com a moeda efetiva via `convertMetaSpendToBrl`.
- UI (`app/admin/meta/page.tsx`): coluna **Moeda** vira `<select>` (BRL/USD). Se a linha está em modo `auto` (sem override), mostra a moeda detectada. Quando há override, exibe link "limpar override" para voltar ao modo automático.

### Painel admin

- Coluna **Spend Insights** mostra `formatMoneyByCurrency(spend, currency)` (ex.: `US$ 12,34`) com badge da moeda; quando não-BRL, mostra `≈ R$ Y` abaixo usando a cotação atual.
- Coluna **Moeda** permite alternar BRL/USD por campanha; o backend recalcula `spend_brl` com base na moeda escolhida e os totais em BRL refletem a alteração após reload do aggregate.
- Cards de "Gasto total · cobrado no cartão" e demais somatórios continuam em BRL (somando `spend_brl` deduplicado).

## Tabelas

- `meta_integrations`: Configuração por banca (token criptografado)
- `meta_campaigns`: Campanhas sincronizadas
- `meta_adsets`: AdSets com orçamento
- `meta_insights_daily`: Insights diários (reach, impressions, clicks, spend, leads)

## API Routes

- `GET/PUT /api/admin/meta/config?banca_id=xxx` - Configuração
- `POST /api/admin/meta/test-connection` - Valida token
- `GET /api/admin/meta/campaigns?banca_id=xxx` - Lista campanhas
- `POST /api/admin/meta/sync` - Sincroniza dados

## Segurança

- Token **nunca** em logs ou resposta de API
- Apenas admin/super_admin podem configurar
- RLS garante acesso restrito às tabelas
