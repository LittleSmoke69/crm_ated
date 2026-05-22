#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# cron-wrapper.sh — invólucro padronizado para todo cron job da Zaploto.
#
# Garantias:
#   1. Lock exclusivo via flock — jobs lentos não disparam em paralelo.
#   2. Timeout duro — job nunca segura o lock indefinidamente.
#   3. Log estruturado: START/END/SKIP/TIMEOUT com timestamp e duração.
#   4. Exit code preservado para o crond (visível em `crontab -l` logs).
#
# Uso (no crontab): cron-wrapper.sh <job-name> [timeout_s]
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

NAME="${1:-}"
TIMEOUT_S="${2:-110}"
APP_DIR="${APP_DIR:-/app}"
NPM_BIN="${NPM_BIN:-npm}"

if [ -z "$NAME" ]; then
  echo "[cron-wrapper] FATAL: nome do job ausente" >&2
  exit 2
fi

LOCK="/tmp/zaploto-cron-${NAME}.lock"
START_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Abre o lock file no FD 9 e tenta lock não-bloqueante.
# Se outro processo já tem, registra SKIP e sai limpo (não é erro).
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[${START_TS}] [SKIP] ${NAME} (lock ocupado por execução anterior)"
  exit 0
fi

echo "[${START_TS}] [START] ${NAME} timeout=${TIMEOUT_S}s"
START_EPOCH=$(date +%s)

cd "$APP_DIR" || {
  echo "[${START_TS}] [FATAL] ${NAME}: cd ${APP_DIR} falhou" >&2
  exit 2
}

# `timeout` envia SIGTERM aos TIMEOUT_S; se ainda vivo após 10s, SIGKILL.
timeout --kill-after=10s "${TIMEOUT_S}s" "$NPM_BIN" run --silent cron:run -- "$NAME"
RC=$?

ELAPSED=$(( $(date +%s) - START_EPOCH ))
END_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case $RC in
  0)   STATUS="OK" ;;
  124) STATUS="TIMEOUT" ;;          # timeout(1) → SIGTERM disparado
  137) STATUS="TIMEOUT_KILLED" ;;   # timeout(1) → SIGKILL após --kill-after
  *)   STATUS="EXIT_${RC}" ;;
esac

echo "[${END_TS}] [END] ${NAME} status=${STATUS} elapsed=${ELAPSED}s"
exit $RC
