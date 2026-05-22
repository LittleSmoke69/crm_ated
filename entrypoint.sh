#!/bin/bash
set -euo pipefail

APP_DIR="/app"
NPM_BIN="$(command -v npm)"
LOG_FILE="/var/log/zaploto-cron.log"

# ── Modo: worker RabbitMQ ────────────────────────────────────────────────────
# Push-based; broker entrega via prefetch. Zero polling.
if [ "${RABBITMQ_WORKER_ONLY:-}" = "true" ]; then
  echo "[entrypoint] Modo RABBITMQ_WORKER_ONLY — iniciando worker (prefetch=${RABBITMQ_WORKER_PREFETCH:-10})..."
  exec env \
    RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672}" \
    RABBITMQ_WORKER_PREFETCH="${RABBITMQ_WORKER_PREFETCH:-10}" \
    RABBITMQ_MAX_RETRIES="${RABBITMQ_MAX_RETRIES:-3}" \
    npm run rabbitmq:worker
fi

# ── Modo: worker maturação ──────────────────────────────────────────────────
# Consome fila maturation.steps com rate-limit por instance_name (Evolution).
if [ "${MATURATION_WORKER_ONLY:-}" = "true" ]; then
  echo "[entrypoint] Modo MATURATION_WORKER_ONLY — iniciando worker (prefetch=${MATURATION_WORKER_PREFETCH:-50}, min_interval=${MATURATION_MIN_INTERVAL_MS_PER_INSTANCE:-2000}ms)..."
  exec env \
    RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672}" \
    MATURATION_WORKER_PREFETCH="${MATURATION_WORKER_PREFETCH:-50}" \
    MATURATION_MAX_RETRIES="${MATURATION_MAX_RETRIES:-2}" \
    MATURATION_MIN_INTERVAL_MS_PER_INSTANCE="${MATURATION_MIN_INTERVAL_MS_PER_INSTANCE:-2000}" \
    npm run maturation:worker
fi

# ── Modo: worker anti-spam ───────────────────────────────────────────────────
# Polling de evolution_webhook_events (sem Next.js).
if [ "${ANTISPAM_WORKER_ONLY:-}" = "true" ]; then
  echo "[entrypoint] Modo ANTISPAM_WORKER_ONLY — iniciando worker anti-spam (poll=${ANTI_SPAM_POLL_MS:-800}ms, batch=${ANTI_SPAM_BATCH_SIZE:-50})..."
  exec env \
    ANTI_SPAM_POLL_MS="${ANTI_SPAM_POLL_MS:-800}" \
    ANTI_SPAM_BATCH_SIZE="${ANTI_SPAM_BATCH_SIZE:-50}" \
    npm run anti-spam:worker
fi

# ── Modo: cron dedicado ──────────────────────────────────────────────────────
# Roda crond em foreground; sem Next.js. SITE_URL/CRON_SECRET vêm via env_file.
if [ "${CRON_ONLY:-}" = "true" ]; then
  echo "[entrypoint] Modo CRON_ONLY — instalando crontab..."
  APP_DIR="$APP_DIR" NPM_BIN="$NPM_BIN" CRON_LOG_FILE="$LOG_FILE" \
    npx tsx scripts/linux/install-linux-cron.ts

  echo "[entrypoint] Cron jobs ativos:"
  crontab -l | grep -v "^#" | grep -v "^$" | grep -v "^CRON_TZ" | grep -v "^PATH" || true

  # Rotação manual diária: trunca o log se ultrapassar 50MB. Evita encher disco.
  # logrotate seria mais robusto, mas requer install e config extra; isto é suficiente.
  (
    while true; do
      sleep 3600
      if [ -f "$LOG_FILE" ]; then
        size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
        if [ "$size" -gt 52428800 ]; then
          echo "[entrypoint] Rotacionando $LOG_FILE (${size} bytes)"
          mv "$LOG_FILE" "${LOG_FILE}.1"
          : > "$LOG_FILE"
        fi
      fi
    done
  ) &

  exec crond -f -l 8
fi

# ── Modo: app Next.js ────────────────────────────────────────────────────────
echo "[entrypoint] Iniciando Next.js na porta ${PORT:-3000}..."
exec npm start -- -p "${PORT:-3000}"
