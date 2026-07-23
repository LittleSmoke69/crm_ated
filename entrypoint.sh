#!/bin/bash
set -euo pipefail

# Stack leve: este artefato inicia somente o servidor HTTP Next.js.
# Workers, RabbitMQ, anti-spam, maturacao e cron nao possuem modo de execucao.
echo "[entrypoint] Iniciando Next.js (escopo=${ZAPLOTO_APP_SCOPE:-modelagem}) na porta ${PORT:-3000}..."
exec npm start -- -p "${PORT:-3000}"
