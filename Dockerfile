ARG VITE_BASE_PATH=/cookbook/

FROM oven/bun:alpine AS build
WORKDIR /app
ARG VITE_BASE_PATH
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

# Install deps (cache-friendly)
COPY package.json bun.lockb bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lockb bun.lock ./
RUN bun install --frozen-lockfile --production

FROM alpine:3.20 AS runtime
WORKDIR /app
ARG VITE_BASE_PATH

# Minimal runtime deps for Bun on Alpine.
RUN apk add --no-cache ca-certificates libstdc++ gcompat

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV COOKBOOK_BASE_PATH=${VITE_BASE_PATH}
# Persist DB by mounting /app/data (or override COOKBOOK_DB_PATH)
ENV COOKBOOK_DB_PATH=/app/data/cookbook.db

COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY package.json bun.lockb bun.lock ./

RUN mkdir -p /app/data
EXPOSE 4000
HEALTHCHECK --interval=2m --timeout=3s --start-period=20s --retries=3 \
  CMD port="${PORT:-4000}"; case "$port" in ''|*[!0-9]*) port=4000 ;; esac; [ "$port" -gt 0 ] 2>/dev/null || port=4000; wget -q -T 2 -O /dev/null "http://127.0.0.1:${port}/health" || exit 1
CMD ["bun", "server/index.ts"]
