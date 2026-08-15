# Imagem única para API e worker.
# Os dois compartilham o mesmo código (o worker importa serviços da API);
# o que muda é só o entrypoint, definido no docker-compose.prod.yml.

# ── Estágio 1: dependências ──────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable

# Só os manifestos primeiro: enquanto eles não mudarem, o Docker reaproveita
# a camada de instalação e o build fica bem mais rápido.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/engine/package.json ./packages/engine/

RUN pnpm install --frozen-lockfile

# ── Estágio 2: build do painel ───────────────────────────────────────
FROM deps AS web-build
WORKDIR /app
COPY . .
RUN pnpm --filter @orbita/web build

# ── Estágio 3: runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN corepack enable && apk add --no-cache tini

# Usuário sem privilégio. Se um módulo de integração for comprometido,
# o processo não tem permissão para escrever fora do que precisa.
RUN addgroup -g 1001 orbita && adduser -u 1001 -G orbita -s /bin/sh -D orbita

COPY --from=deps --chown=orbita:orbita /app/node_modules ./node_modules
COPY --from=deps --chown=orbita:orbita /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps --chown=orbita:orbita /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --chown=orbita:orbita . .

USER orbita

ENV NODE_ENV=production

# tini como PID 1: garante que SIGTERM chegue ao processo Node, para o
# encerramento gracioso do worker (esperar os jobs em andamento) funcionar.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@orbita/api", "start"]
