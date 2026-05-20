#!/bin/bash
set -e

APP_DIR="/app"
NPM_BIN="$(which npm)"
LOG_FILE="/var/log/zaploto-cron.log"

# Só instala cron na instância primária
if [ "${CRON_ENABLED}" = "true" ]; then
  echo "[entrypoint] Instalando cron jobs..."
  APP_DIR="$APP_DIR" NPM_BIN="$NPM_BIN" CRON_LOG_FILE="$LOG_FILE" \
    npx tsx scripts/linux/install-linux-cron.ts

  echo "[entrypoint] Iniciando daemon de cron..."
  crond -b -l 8

  echo "[entrypoint] Cron jobs instalados:"
  crontab -l | grep -v "^#" | grep -v "^$" | grep -v "^CRON_TZ" | grep -v "^PATH" || true
else
  echo "[entrypoint] Instância worker — cron desabilitado."
fi

echo "[entrypoint] Iniciando webhook queue worker (concorrência=${WEBHOOK_WORKER_CONCURRENCY:-8})..."
REDIS_QUEUE_URL="${REDIS_QUEUE_URL:-redis://:redis123@redis_shared:6379}" \
WEBHOOK_WORKER_CONCURRENCY="${WEBHOOK_WORKER_CONCURRENCY:-8}" \
  npm run webhook:worker >> /var/log/zaploto-webhook-worker.log 2>&1 &
echo "[entrypoint] Webhook worker iniciado (PID=$!)"

echo "[entrypoint] Iniciando Next.js na porta ${PORT:-3000}..."
exec npm start -- -p ${PORT:-3000}
