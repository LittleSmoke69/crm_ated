# Deploy VPS — Supabase self-hosted + CRM modelagem leve

Esta é a configuração de produção suportada por este repositório:

- Supabase self-hosted oficial em `/opt/supabase`;
- migrations de `migrations/modelagem`, em ordem lexical;
- somente `app1` e `app2` para servir o Next.js;
- sem RabbitMQ, workers, container cron ou Scheduled Functions do Netlify;
- sem anti-spam, maturação, Evolution e processadores de envio;
- módulos visíveis controlados pelo catálogo/permissões da sidebar.

## 1. Requisitos

VPS Ubuntu/Debian com Git, Docker Engine, plugin Docker Compose e OpenSSL.
Reserve ao menos 8 GB de RAM para Supabase + CRM; 12 GB ou mais é recomendado.

```bash
docker --version
docker compose version
git --version
openssl version
free -h
df -h
```

## 2. Supabase self-hosted

Instalação nova:

```bash
sudo mkdir -p /opt/supabase
sudo chown -R "$USER":"$USER" /opt/supabase
git clone --depth 1 https://github.com/supabase/supabase.git /opt/supabase-source
cp -a /opt/supabase-source/docker/. /opt/supabase/
cd /opt/supabase
cp .env.example .env
chmod 600 .env
sh ./utils/generate-keys.sh
nano .env
```

Configure no `.env` do Supabase:

```dotenv
SUPABASE_PUBLIC_URL=https://supabase.seudominio.com
API_EXTERNAL_URL=https://supabase.seudominio.com
SITE_URL=https://crm.seudominio.com
ADDITIONAL_REDIRECT_URLS=https://crm.seudominio.com/**
DASHBOARD_USERNAME=troque_este_usuario
DASHBOARD_PASSWORD=troque_esta_senha
DISABLE_SIGNUP=true
```

Não reutilize os valores padrão. Depois suba e valide:

```bash
cd /opt/supabase
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 db kong rest auth
curl -i http://127.0.0.1:8000/rest/v1/
```

## 3. CRM

```bash
sudo mkdir -p /opt/crm-ated
sudo chown -R "$USER":"$USER" /opt/crm-ated
git clone https://github.com/LittleSmoke69/crm_ated.git /opt/crm-ated
cd /opt/crm-ated
docker network inspect ZAPLOTOV3 >/dev/null 2>&1 || docker network create ZAPLOTOV3
cp .env.example .env
chmod 600 .env
```

Recupere as chaves geradas pelo Supabase sem imprimi-las na tela:

```bash
SUPABASE_ANON_KEY="$(sed -n 's/^ANON_KEY=//p' /opt/supabase/.env)"
SUPABASE_SERVICE_KEY="$(sed -n 's/^SERVICE_ROLE_KEY=//p' /opt/supabase/.env)"
test -n "$SUPABASE_ANON_KEY" && echo "ANON_KEY encontrada"
test -n "$SUPABASE_SERVICE_KEY" && echo "SERVICE_ROLE_KEY encontrada"
```

Edite `/opt/crm-ated/.env` e preencha as chaves, os domínios e dois
segredos diferentes gerados com `openssl rand -hex 48`.

Variáveis obrigatórias:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://supabase.seudominio.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon_key_do_supabase
SUPABASE_SERVICE_ROLE_KEY=service_role_key_do_supabase
SITE_URL=https://crm.seudominio.com
URL=https://crm.seudominio.com
NEXT_PUBLIC_SITE_URL=https://crm.seudominio.com
SESSION_SECRET=segredo_aleatorio
ENCRYPTION_PEPPER=outro_segredo_aleatorio
# Com Evolution (Cap): use full + vars da seção 10. Sem Evolution: modelagem + disable true.
NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=full
ZAPLOTO_APP_SCOPE=full
NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK=false
ZAPLOTO_DISABLE_EVOLUTION_STACK=false

# E-mail na SuperBitHost: SMTP outbound é bloqueado — use o relay na Contabo
# (veja email-relay/README.md). Sem isso, campanhas falham com Connection timeout.
EMAIL_RELAY_URL=https://mail-relay.seudominio.com
EMAIL_RELAY_SECRET=mesmo_secret_do_container_email-relay
```

Nunca use a `SERVICE_ROLE_KEY` em `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Relay de e-mail (Contabo)

Na SuperBitHost as portas 465/587 estão filtradas. Suba `email-relay/` na Contabo
(onde o SMTP Hostinger abre) e aponte `EMAIL_RELAY_URL` / `EMAIL_RELAY_SECRET` no
`.env` do CRM. Detalhes e checklist: `email-relay/README.md`.

## 4. Migrations

Confirme primeiro o nome do container PostgreSQL. Na instalação oficial é
normalmente `supabase-db`:

```bash
docker exec supabase-db psql -U postgres -d postgres -c 'select version();'
```

Aplique todos os SQL de modelagem em ordem. O comando para no primeiro erro:

```bash
cd /opt/crm-ated
for migration_file in migrations/modelagem/[0-9][0-9]_*.sql; do
  echo "Aplicando: $migration_file"
  docker exec -i supabase-db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < "$migration_file" || break
done
```

Atualize o cache do PostgREST e verifique o núcleo:

```bash
docker exec supabase-db psql -U postgres -d postgres \
  -c "NOTIFY pgrst, 'reload schema';"
docker exec supabase-db psql -U postgres -d postgres \
  -c "SELECT to_regclass('public.profiles'), to_regclass('public.crm_columns'), to_regclass('public.chat_conversations'), to_regclass('public.meta_ads');"
```

## 5. Build e usuário inicial

O build recebe o escopo via `.env` / build-args (`full` ou `modelagem`).

```bash
cd /opt/crm-ated
docker compose config
docker compose build --pull app1
```

Crie ou redefina o acesso de `carlinhosbigdata@gmail.com`:

```bash
read -s -p "Senha inicial: " ADMIN_PASSWORD
echo
ADMIN_HASH="$(
  printf '%s' "$ADMIN_PASSWORD" |
  docker run --rm -i --entrypoint node zaplotov3-app \
    -e "const fs=require('fs');const b=require('bcryptjs');const p=fs.readFileSync(0,'utf8');process.stdout.write(b.hashSync(p,12))"
)"
unset ADMIN_PASSWORD
```

```bash
printf "
UPDATE public.profiles
SET full_name='Carlinhos Big Data', password_hash='%s', status='super_admin',
    zaploto_id=(SELECT id FROM public.zaploto_tenants WHERE slug='zaploto'),
    updated_at=now()
WHERE lower(trim(email))='carlinhosbigdata@gmail.com';

INSERT INTO public.profiles
  (full_name,email,password_hash,status,zaploto_id,created_at,updated_at)
SELECT 'Carlinhos Big Data','carlinhosbigdata@gmail.com','%s','super_admin',id,now(),now()
FROM public.zaploto_tenants
WHERE slug='zaploto'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(trim(email))='carlinhosbigdata@gmail.com'
  );
" "$ADMIN_HASH" "$ADMIN_HASH" |
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
unset ADMIN_HASH
```

## 6. Subir ou migrar da stack antiga

O comando abaixo recria os dois apps e remove os containers órfãos antigos,
sem usar `-v` e sem apagar volumes do Supabase:

```bash
cd /opt/crm-ated
docker compose up -d --build --remove-orphans
docker compose ps
```

Resultado esperado de `docker compose ps --services`:

```text
app1
app2
```

Teste:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/api/health
docker stats --no-stream zaplotov3-1 zaplotov3-2
```

## 7. Proxy reverso

Use os dois containers no upstream do Nginx:

```nginx
upstream crm_backend {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}
```

Exponha somente 80/443. Não exponha PostgreSQL, Studio ou portas internas do
Supabase sem autenticação adicional, VPN ou proxy de acesso.

## 8. Atualizações e rollback

Antes de atualizar, faça backup do PostgreSQL. Depois:

```bash
cd /opt/crm-ated
git pull --ff-only origin main
docker compose config
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs --tail=100 app1 app2
```

Para rollback do aplicativo, use o hash do commit anterior e reconstrua a
imagem. Não execute `docker compose down -v`, pois isso pode apagar volumes.

## 9. O que não roda nesta edição (sem containers extras)

- RabbitMQ e workers dedicados (opcional: defina `RABBITMQ_URL` se subir o broker);
- anti-spam em tempo real ou scanner periódico (workers);
- maturação / campanhas em background / cron Netlify.

Com `NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=full`, o chat Evolution funciona: o endpoint
`/api/webhooks/evolution/prod` processa em **sync** (grava `evolution_webhook_events`
+ conversas) quando `RABBITMQ_URL` não está definido.

A visibilidade da sidebar continua em `zaploto_sidebar_items` / `zaploto_role_sidebar`.

## 10. Evolution em produção (Cap do Sucesso)

### DNS / URL pública

O CRM Cap já responde em `https://capdosucesso.co.uk`. Use essa URL (ou
`https://crm.capdosucesso.co.uk` se criar CNAME/A + TLS apontando para o mesmo
upstream Nginx dos `app1`/`app2`).

```text
# Opcional — subdomain dedicado
crm.capdosucesso.co.uk  CNAME  →  capdosucesso.co.uk
# ou A → IP do VPS (mesmo proxy reverso da seção 7)
```

### .env no VPS (`/opt/crm-ated/.env`)

Além do bloco Supabase/sessão:

```dotenv
NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=full
ZAPLOTO_APP_SCOPE=full
NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK=false
ZAPLOTO_DISABLE_EVOLUTION_STACK=false

SITE_URL=https://capdosucesso.co.uk
URL=https://capdosucesso.co.uk
NEXT_PUBLIC_SITE_URL=https://capdosucesso.co.uk
NEXT_PUBLIC_APP_URL=https://capdosucesso.co.uk
NEXT_PUBLIC_WEBHOOK_BASE_URL=https://capdosucesso.co.uk

EVOLUTION_BASE_URL=https://evolution.capdosucesso.co.uk
EVOLUTION_API_KEY=sua_api_key_global
EVOLUTION_WEBHOOK_SECRET_PROD=$(openssl rand -hex 32)
EVOLUTION_WEBHOOK_SECRET_TEST=$(openssl rand -hex 32)
EVOLUTION_WEBHOOK_SKIP_MASTER=false
```

Não defina `EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN`, `EVOLUTION_WEBHOOK_ALLOW_LOCALHOST`
nem `RABBITMQ_URL` neste stack.

### Migrations Evolution

```bash
cd /opt/crm-ated
for f in migrations/modelagem/23_evolution_stack.sql migrations/modelagem/24_evolution_webhook_events.sql; do
  echo "Aplicando: $f"
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
docker exec supabase-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
```

### Deploy e cutover do webhook

```bash
cd /opt/crm-ated
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
curl -fsS https://capdosucesso.co.uk/api/webhooks/evolution/prod
# Esperado: "mode":"sync"
```

Com o `.env` de produção no diretório do repo (ou no VPS):

```bash
node scripts/cutover-evolution-webhook-prod.cjs Teste
```

Isso registra na Evolution:

- URL: `https://capdosucesso.co.uk/api/webhooks/evolution/prod`
- Header: `x-zaploto-token: <EVOLUTION_WEBHOOK_SECRET_PROD>`
- Eventos: `MESSAGES_UPSERT`, `SEND_MESSAGE`

Teste: envie uma mensagem WhatsApp para a instância e confira `/chat`.

### Segurança

- Rotacione `EVOLUTION_API_KEY` no Manager se a chave vazou em chat/logs.
- Nunca commite `.env`. Use `.env.example` como referência.

