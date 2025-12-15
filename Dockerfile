FROM oven/bun:alpine AS build
WORKDIR /app

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

# Minimal runtime deps for Bun on Alpine.
RUN apk add --no-cache ca-certificates libstdc++ gcompat

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
# Persist DB by mounting /app/data (or override COOKBOOK_DB_PATH)
ENV COOKBOOK_DB_PATH=/app/data/cookbook.db

COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY package.json bun.lockb bun.lock ./

RUN mkdir -p /app/data
EXPOSE 4000
CMD ["bun", "server/index.ts"]
