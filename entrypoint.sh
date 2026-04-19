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

echo "[entrypoint] Iniciando Next.js na porta ${PORT:-3000}..."
exec npm start -- -p ${PORT:-3000}
