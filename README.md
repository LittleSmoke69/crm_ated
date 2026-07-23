# CRM AT — stack modelagem leve

Aplicação Next.js para o escopo de modelagem, implantada com Supabase
self-hosted e duas réplicas HTTP.

## Produção

A stack ativa contém somente:

- `app1`, porta 3000;
- `app2`, porta 3001;
- Supabase self-hosted em um Compose separado.

RabbitMQ, workers, anti-spam, maturação, container cron e Scheduled Functions
do Netlify não fazem parte desta edição.

O processo completo está em [DEPLOY_STACK_LEVE.md](./DEPLOY_STACK_LEVE.md).

## Desenvolvimento

```bash
cp .env.example .env
npm ci
npm run dev
```

Abra `http://localhost:3000`. Para validar produção:

```bash
npm run build
```

## Banco

As migrations isoladas ficam em `migrations/modelagem` e devem ser executadas
em ordem lexical. Veja [migrations/modelagem/README.md](./migrations/modelagem/README.md).

Nunca versione `.env`, `SUPABASE_SERVICE_ROLE_KEY`, senhas ou tokens.
