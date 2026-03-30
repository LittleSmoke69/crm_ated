#!/usr/bin/env bash
# Aplica db/homolog/*.sql na ordem de ORDEM_EXECUCAO.txt (linhas que terminam em .sql)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
H="$ROOT/db/homolog"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Defina DATABASE_URL." >&2
  exit 1
fi
grep '\.sql$' "$H/ORDEM_EXECUCAO.txt" | while read -r f; do
  [[ "$f" =~ ^# ]] && continue
  p="$H/$f"
  [[ -f "$p" ]] || { echo "Ausente: $p" >&2; exit 1; }
  echo "==> $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$p"
done
echo "Homolog aplicado."
