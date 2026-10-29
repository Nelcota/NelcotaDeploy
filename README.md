# Nelcota Deploy

Self-hosted deploy panel for a single Linux VPS with Docker, in the spirit of Railway, Coolify
and Dokploy. Point it at a GitHub repository with a Dockerfile, set variables and domains, and
deploy: the worker builds the exact commit, health checks the new container and only then
replaces the old one.

## Features

- Deploys from GitHub (manual or on push), rollback, redeploy and retry
- Live build and runtime logs, CPU and memory metrics
- Variables and secrets (AES-256-GCM), domains with automatic HTTPS via Traefik
- Scheduled tasks inside the app container
- Users with roles, API tokens and an MCP server for AI clients
- Audit log of every administrative action

## Stack

Bun · TanStack Start · React · Tailwind · SQLite (Drizzle) · Better Auth · Docker CLI · Traefik

## Quick start

Requires Linux with Bun 1.4+, git and Docker 23+.

```bash
bun install
bun run setup                                    # writes .env with generated secrets
bun run admin:create --email you@example.com     # first admin; prints the password once
bun run dev                                      # panel on http://localhost:3000
bun run worker                                   # in another terminal: deploys, tasks, metrics
```

## Production

```bash
bun run setup        # then set PUBLIC_URL, PANEL_DOMAIN and ACME_EMAIL in .env
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" >> .env
docker compose up -d --build
docker compose exec web bun run admin:create --email you@example.com
```

## Development

```bash
bun run check        # format, lint, types, unused code and tests
bun run ui:review    # screenshots of every screen and an accessibility report
```

The full guide (architecture, webhook, MCP, backup, troubleshooting) is in
[docs/guia.md](docs/guia.md), in Portuguese.
