#!/usr/bin/env bash
# Instala Evolution API 2.3.7 em /opt/evolution-api
# Domínio: evolution.capdosucesso.co.uk
# Uso (como root na VPS): bash install.sh
set -euo pipefail

DOMAIN="${DOMAIN:-evolution.capdosucesso.co.uk}"
INSTALL_DIR="${INSTALL_DIR:-/opt/evolution-api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Rode como root: sudo bash $0"
  exit 1
fi

echo "==> Domínio: $DOMAIN"
echo "==> Pasta: $INSTALL_DIR"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg openssl

# Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null

mkdir -p "$INSTALL_DIR"
cp -f "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"

API_KEY="$(openssl rand -hex 24)"
PG_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"

cat > "$INSTALL_DIR/.env" <<EOF
SERVER_NAME=evolution
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://${DOMAIN}

CORS_ORIGIN=*
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true

LOG_LEVEL=ERROR,WARN,INFO,LOG
LOG_COLOR=true
LOG_BAILEYS=error

DEL_INSTANCE=false

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:${PG_PASS}@postgres:5432/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=evolution_api
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=true
DATABASE_SAVE_DATA_HISTORIC=true
DATABASE_SAVE_IS_ON_WHATSAPP=true
DATABASE_SAVE_IS_ON_WHATSAPP_DAYS=7
DATABASE_DELETE_MESSAGE=true

POSTGRES_DATABASE=evolution
POSTGRES_USERNAME=evolution
POSTGRES_PASSWORD=${PG_PASS}

CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://evolution-redis:6379/1
CACHE_REDIS_TTL=604800
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false

RABBITMQ_ENABLED=false
WEBSOCKET_ENABLED=true
WEBSOCKET_GLOBAL_EVENTS=false
WEBSOCKET_ALLOWED_HOSTS=*

WEBHOOK_GLOBAL_ENABLED=false

CONFIG_SESSION_PHONE_CLIENT=Cap do Sucesso
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
QRCODE_COLOR='#E86A24'

S3_ENABLED=false
AUTHENTICATION_API_KEY=${API_KEY}
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
LANGUAGE=pt
TELEMETRY_ENABLED=false
EOF

chmod 600 "$INSTALL_DIR/.env"
echo "$API_KEY" > "$INSTALL_DIR/API_KEY.txt"
chmod 600 "$INSTALL_DIR/API_KEY.txt"

ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

echo "==> Subindo containers..."
cd "$INSTALL_DIR"
docker compose pull
docker compose up -d

setup_nginx() {
  apt-get install -y nginx certbot python3-certbot-nginx
  cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 50M;

    location /manager/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX
  ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
  nginx -t
  systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
    echo "AVISO: certbot falhou. Confira DNS A de $DOMAIN -> IP desta VPS e rode:"
    echo "  certbot --nginx -d $DOMAIN"
  }
}

setup_caddy() {
  if ! command -v caddy >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -y
    apt-get install -y caddy
  fi
  # Não sobrescreve Caddyfile inteiro se já houver outros sites
  if [[ -f /etc/caddy/Caddyfile ]] && grep -qE '^[a-zA-Z0-9.-]+ \{' /etc/caddy/Caddyfile && ! grep -q "$DOMAIN" /etc/caddy/Caddyfile; then
    cat >> /etc/caddy/Caddyfile <<CADDY

${DOMAIN} {
	encode gzip
	handle_path /manager* {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}
CADDY
  else
    cp -f "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
  fi
  systemctl enable --now caddy
  systemctl reload caddy || systemctl restart caddy
}

echo "==> Configurando reverse proxy + SSL (nginx)..."
# Esta VPS (SuperBitHost) já usa nginx para o CRM — mantemos o mesmo padrão.
setup_nginx

sleep 6
echo "==> Status containers:"
docker compose ps

echo
echo "=============================================="
echo " Evolution API 2.3.7 instalada"
echo " URL:     https://${DOMAIN}"
echo " Manager: https://${DOMAIN}/manager/"
echo " API KEY: ${API_KEY}"
echo " (salva em ${INSTALL_DIR}/API_KEY.txt)"
echo "=============================================="
echo "Header: apikey: ${API_KEY}"
echo "Teste:  curl -sS https://${DOMAIN}/ -H \"apikey: ${API_KEY}\""
