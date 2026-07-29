#!/usr/bin/env bash
# Rode no VPS em /opt/crm-ated (ou clone do CRM) após git pull com este commit.
# 1) Aplica migrations Evolution se necessário
# 2) Rebuild app1/app2
# 3) Cutover do webhook da instância (default: Teste)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INSTANCE_NAME="${1:-Teste}"

if [[ ! -f .env ]]; then
  echo "Crie .env a partir de .env.example (seção Evolution / full)." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
# carrega só linhas KEY=VAL sem exportar comentários
source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed 's/\r$//')
set +a

echo "==> Health pré-deploy"
curl -fsS "${NEXT_PUBLIC_APP_URL:-https://capdosucesso.co.uk}/api/health" || true

echo "==> Migrations Evolution (idempotentes)"
if docker ps --format '{{.Names}}' | grep -qx supabase-db; then
  for f in migrations/modelagem/23_evolution_stack.sql migrations/modelagem/24_evolution_webhook_events.sql; do
    echo "Aplicando $f"
    docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
  done
  docker exec supabase-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
else
  echo "Container supabase-db não encontrado — aplique 23/24 manualmente no SQL Editor."
fi

echo "==> Rebuild"
docker compose up -d --build --remove-orphans
docker compose ps

echo "==> Health webhook prod"
sleep 5
curl -fsS "${NEXT_PUBLIC_APP_URL:-https://capdosucesso.co.uk}/api/webhooks/evolution/prod"
echo

echo "==> Cutover Evolution → CRM"
if command -v node >/dev/null 2>&1; then
  node scripts/cutover-evolution-webhook-prod.cjs "$INSTANCE_NAME"
else
  echo "Node não disponível — rode: node scripts/cutover-evolution-webhook-prod.cjs $INSTANCE_NAME"
fi

echo "OK. Envie uma mensagem WhatsApp para a instância $INSTANCE_NAME e confira /chat."
echo "Recomendado: rotacionar EVOLUTION_API_KEY no Manager se a chave vazou."
