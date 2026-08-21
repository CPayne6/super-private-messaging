# syntax=docker/dockerfile:1
FROM node:22.17.1-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile
COPY . .
FROM base AS api-build
RUN rm -f packages/protocol/tsconfig.tsbuildinfo apps/api/tsconfig.tsbuildinfo apps/web/tsconfig.tsbuildinfo \
  && pnpm --filter @spm/protocol build \
  && pnpm --filter @spm/api build \
  && pnpm --filter @spm/api --prod deploy --legacy /app/production-api

# Development targets keep the workspace dependencies in the image while
# Compose bind-mounts only the files that should be watched.
FROM base AS api-dev
WORKDIR /app/apps/api
EXPOSE 8010
CMD ["pnpm", "dev"]

FROM base AS web-dev
WORKDIR /app/apps/web
EXPOSE 3010
CMD ["pnpm", "dev"]

FROM node:22.17.1-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 spm
COPY --from=api-build --chown=spm:spm /app/production-api ./
USER 10001
EXPOSE 8010
CMD ["node", "dist/main.js"]

FROM postgres:17-alpine AS migrate
COPY apps/api/migrations /migrations
ENTRYPOINT ["/bin/sh", "/migrations/migrate.sh"]

FROM base AS web-build
RUN rm -f packages/protocol/tsconfig.tsbuildinfo apps/web/tsconfig.tsbuildinfo \
  && pnpm --filter @spm/protocol build \
  && pnpm --filter @spm/web build
FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
