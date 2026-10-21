ARG BUN_VERSION
ARG VITE_BASE_PATH=/cookbook/
ARG VITE_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH=2000000

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
ARG VITE_BASE_PATH
ARG VITE_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV VITE_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH=${VITE_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH}

# Install deps (cache-friendly)
COPY package.json bun.lockb bun.lock ./
COPY cli/trusted-ca.ts ./cli/trusted-ca.ts
COPY scripts/export-trusted-ca.ts ./scripts/export-trusted-ca.ts
COPY scripts/registry-ca.ts ./scripts/registry-ca.ts
RUN bun scripts/export-trusted-ca.ts /tmp/cookbook-ca.pem \
    && NODE_TLS_REJECT_UNAUTHORIZED=1 bun install --frozen-lockfile --cafile=/tmp/cookbook-ca.pem

COPY . .
RUN bun run build

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS prod-deps
WORKDIR /app
ARG TARGETARCH
COPY package.json bun.lockb bun.lock ./
COPY cli/trusted-ca.ts ./cli/trusted-ca.ts
COPY scripts/export-trusted-ca.ts ./scripts/export-trusted-ca.ts
COPY scripts/registry-ca.ts ./scripts/registry-ca.ts
RUN case "$TARGETARCH" in \
      amd64) bun_cpu=x64 ;; \
      arm64) bun_cpu=arm64 ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && bun scripts/export-trusted-ca.ts /tmp/cookbook-ca.pem \
    && NODE_TLS_REJECT_UNAUTHORIZED=1 bun install --frozen-lockfile --production --cpu="$bun_cpu" --os=linux --cafile=/tmp/cookbook-ca.pem

FROM oven/bun:${BUN_VERSION}-alpine AS target-bun

FROM alpine:3.24 AS runtime
WORKDIR /app
ARG VITE_BASE_PATH

# Minimal runtime deps for Bun on Alpine.
RUN apk add --no-cache 'ca-certificates>=20261020-r0' libstdc++ gcompat

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV COOKBOOK_BASE_PATH=${VITE_BASE_PATH}
# Persist DB by mounting /app/data (or override COOKBOOK_DB_PATH)
ENV COOKBOOK_DB_PATH=/app/data/cookbook.db
ENV PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH=2000000

COPY --from=target-bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY package.json bun.lockb bun.lock ./

RUN mkdir -p /app/data
EXPOSE 4000
HEALTHCHECK --interval=2m --timeout=3s --start-period=20s --retries=3 \
  CMD port="${PORT:-4000}"; case "$port" in ''|*[!0-9]*) port=4000 ;; esac; [ "$port" -gt 0 ] 2>/dev/null || port=4000; wget -q -T 2 -O /dev/null "http://127.0.0.1:${port}/health" || exit 1
CMD ["bun", "server/index.ts"]
