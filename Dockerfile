FROM node:20-alpine AS builder

WORKDIR /app

# NEXT_PUBLIC_* precisam estar disponíveis em build time para o Next.js embuti-los no bundle.
# São passados como build args pelo docker-compose (lidos do .env da VPS) — o .env
# em si é excluído do contexto de build via .dockerignore.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=modelagem
ARG NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK=true
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=$NEXT_PUBLIC_ZAPLOTO_APP_SCOPE
ENV NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK=$NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK

# Install dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source and build (cache Next.js compilation between builds)
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Runtime leve: bash para o entrypoint, ffmpeg para mídia do chat oficial e
# tini como PID 1. Não instala daemon de cron nem utilitários dos workers.
RUN apk add --no-cache bash ffmpeg tini

# Copy built app and node_modules
COPY --from=builder /app ./

# Permissão executável do entrypoint HTTP.
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

# tini como PID 1 repassa SIGTERM ao Next.js e colhe processos zumbis.
ENTRYPOINT ["/sbin/tini", "--", "/app/entrypoint.sh"]
