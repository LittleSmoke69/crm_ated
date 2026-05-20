FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source and build (cache Next.js compilation between builds)
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install cron + flock (util-linux) + bash + ffmpeg (conversão de áudio)
RUN apk add --no-cache dcron util-linux bash ffmpeg

# Copy built app and node_modules
COPY --from=builder /app ./

# Create log file for cron
RUN mkdir -p /var/log && touch /var/log/zaploto-cron.log && chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
