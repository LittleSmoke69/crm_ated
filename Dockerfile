FROM node:20-alpine AS builder

WORKDIR /app

# NEXT_PUBLIC_* precisam estar disponíveis em build time para o Next.js embuti-los no bundle.
# São passados como build args pelo docker-compose (lidos do .env da VPS) — o .env
# em si é excluído do contexto de build via .dockerignore.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Install dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source and build (cache Next.js compilation between builds)
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Pacotes do runtime:
#   dcron       — daemon de cron do Alpine
#   util-linux  — provê flock(1) (usado pelo cron-wrapper)
#   coreutils   — provê timeout(1) (a versão do busybox não tem --kill-after)
#   bash        — entrypoint e wrapper usam bash
#   ffmpeg      — conversão de áudio (WhatsApp ptt/ptv)
#   procps      — pgrep (usado no healthcheck do container cron)
#   tini        — init mínimo (PID 1) para repassar SIGTERM e reapear zumbis
RUN apk add --no-cache dcron util-linux coreutils bash ffmpeg procps tini

# Copy built app and node_modules
COPY --from=builder /app ./

# Permissões executáveis para entrypoint e wrappers shell.
RUN mkdir -p /var/log \
 && touch /var/log/zaploto-cron.log \
 && chmod +x /app/entrypoint.sh \
 && chmod +x /app/scripts/linux/cron-wrapper.sh

EXPOSE 3000

# tini como PID 1 — repassa SIGTERM para Next.js/workers e colhe processos zumbis
# (importante quando o entrypoint dispara processos em background).
ENTRYPOINT ["/sbin/tini", "--", "/app/entrypoint.sh"]
