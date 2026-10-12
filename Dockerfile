# Imagem única para web e worker (o comando define o papel).
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl qpdf ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 labelhub && mkdir -p /app/.storage && chown labelhub /app/.storage
COPY --from=build --chown=labelhub /app ./
USER labelhub
EXPOSE 3000
# Web: npm run start  |  Worker: npm run worker  |  Migrações: npx prisma migrate deploy
CMD ["npm", "run", "start"]
