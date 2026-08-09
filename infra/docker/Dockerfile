# Single image, three entrypoints: api, worker, cli. One build, one thing to
# scan and patch, and the worker/API can never drift apart in dependencies.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime
# git is not optional: worktrees are how coding agents are isolated.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV NODE_ENV=production
# Overridden per service in compose / task definitions.
CMD ["node", "apps/worker/dist/main.js"]
