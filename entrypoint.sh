#!/bin/bash
set -e

APP_DIR="/app"
NPM_BIN="$(which npm)"
LOG_FILE="/var/log/zaploto-cron.log"

# Modo worker RabbitMQ dedicado: push-based, zero polling
if [ "${RABBITMQ_WORKER_ONLY}" = "true" ]; then
  echo "[entrypoint] Modo RABBITMQ_WORKER_ONLY — iniciando worker (prefetch=${RABBITMQ_WORKER_PREFETCH:-10})..."
  exec env \
    RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672}" \
    RABBITMQ_WORKER_PREFETCH="${RABBITMQ_WORKER_PREFETCH:-10}" \
    RABBITMQ_MAX_RETRIES="${RABBITMQ_MAX_RETRIES:-3}" \
    npm run rabbitmq:worker
fi

# Modo worker BullMQ dedicado (legado): roda só o worker, sem Next.js
if [ "${WORKER_ONLY}" = "true" ]; then
  echo "[entrypoint] Modo WORKER_ONLY — iniciando worker (concorrência=${WEBHOOK_WORKER_CONCURRENCY:-2})..."
  exec env \
    REDIS_QUEUE_URL="${REDIS_QUEUE_URL:-redis://:redis123@redis_shared:6379}" \
    WEBHOOK_WORKER_CONCURRENCY="${WEBHOOK_WORKER_CONCURRENCY:-2}" \
    npm run webhook:worker
fi

# Modo cron dedicado: instala e roda cron em foreground, sem Next.js
if [ "${CRON_ONLY}" = "true" ]; then
  echo "[entrypoint] Modo CRON_ONLY — instalando e iniciando cron em foreground..."
  APP_DIR="$APP_DIR" NPM_BIN="$NPM_BIN" CRON_LOG_FILE="$LOG_FILE" \
    npx tsx scripts/linux/install-linux-cron.ts
  echo "[entrypoint] Cron jobs instalados:"
  crontab -l | grep -v "^#" | grep -v "^$" | grep -v "^CRON_TZ" | grep -v "^PATH" || true
  exec crond -f -l 8
fi

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

# Inicia worker em background apenas se concurrency > 0
if [ "${WEBHOOK_WORKER_CONCURRENCY:-8}" != "0" ]; then
  echo "[entrypoint] Iniciando webhook queue worker (concorrência=${WEBHOOK_WORKER_CONCURRENCY:-8})..."
  REDIS_QUEUE_URL="${REDIS_QUEUE_URL:-redis://:redis123@redis_shared:6379}" \
  WEBHOOK_WORKER_CONCURRENCY="${WEBHOOK_WORKER_CONCURRENCY:-8}" \
    npm run webhook:worker >> /var/log/zaploto-webhook-worker.log 2>&1 &
  echo "[entrypoint] Webhook worker iniciado (PID=$!)"
else
  echo "[entrypoint] Webhook worker desabilitado (WEBHOOK_WORKER_CONCURRENCY=0)."
fi

echo "[entrypoint] Iniciando Next.js na porta ${PORT:-3000}..."
exec npm start -- -p ${PORT:-3000}
