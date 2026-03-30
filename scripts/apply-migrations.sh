#!/usr/bin/env bash
# Aplica todas as migrations SQL na ordem definida em migrations/migrations_order.txt
# Uso: export DATABASE_URL="postgresql://..." && ./scripts/apply-migrations.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORDER_FILE="$ROOT/migrations/migrations_order.txt"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Defina DATABASE_URL (connection string Postgres do Supabase ou local)." >&2
  exit 1
fi

if [[ ! -f "$ORDER_FILE" ]]; then
  echo "Arquivo não encontrado: $ORDER_FILE" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  file="$line"
  path="$ROOT/migrations/$file"
  if [[ ! -f "$path" ]]; then
    echo "Arquivo ausente: $path" >&2
    exit 1
  fi
  echo "==> $file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
done < "$ORDER_FILE"

echo "Migrations concluídas."
