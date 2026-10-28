# syntax=docker/dockerfile:1
# One image for both processes: `web` (panel) and `worker` (jobs + Docker access).

FROM oven/bun:1.4.4-slim AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# --ignore-scripts skips the git hook installer, which needs a git checkout.
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY . .
RUN bun run build

FROM dependencies AS production-dependencies
RUN rm -rf node_modules && bun install --frozen-lockfile --ignore-scripts --production

# The worker shells out to the docker CLI (with BuildKit) and git; the web never uses them.
FROM docker:29-cli AS docker-cli

FROM oven/bun:1.4.4-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
WORKDIR /app
ENV NODE_ENV=production \
  DATABASE_PATH=/data/nelcota.db \
  WORKSPACE_DIR=/data/workspaces \
  HOST=0.0.0.0 \
  PORT=3000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json bunfig.toml tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src
RUN mkdir -p /data/workspaces && chown -R bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
