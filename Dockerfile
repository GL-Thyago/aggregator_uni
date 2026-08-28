FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NPM_CONFIG_FETCH_RETRIES=8 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY admin ./admin
COPY aggregator_adm ./aggregator_adm

RUN npx prisma generate && npm prune --omit=dev

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/generated ./generated
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY admin ./admin
COPY aggregator_adm ./aggregator_adm
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh \
  && mkdir -p /app/games /app/data/covers

EXPOSE 3010

ENTRYPOINT ["./docker-entrypoint.sh"]
