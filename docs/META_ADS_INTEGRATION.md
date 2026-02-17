# Integração Meta Ads (Facebook/Instagram)

Integração com Meta Graph API para alimentar o Gestor de Tráfego com métricas de campanhas (alcance, impressões, cliques, leads, spend).

## Configuração

### Variáveis de ambiente

- `ENCRYPTION_PEPPER`: Chave usada para criptografar o token da Meta no banco. Configure em produção.
- O token é armazenado criptografado em `meta_integrations.access_token_encrypted`.

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
