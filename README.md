<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/nelcota-logo-white.svg" />
  <img src="public/nelcota-logo-black.svg" alt="Nelcota" width="220" />
</picture>

<h3>Nelcota Deploy</h3>

<p>Self-hosted deploy panel for Linux VPSs with Docker: one server or many over SSH.<br />
Push to GitHub, get a running container with logs, metrics and HTTPS.</p>

<p>
  <a href="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml"><img alt="Check" src="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml/badge.svg" /></a>
  <img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-black?logo=bun" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/database-SQLite-003b57?logo=sqlite&logoColor=white" />
</p>

<img src="docs/images/dashboard.png" alt="Nelcota Deploy dashboard" width="900" />

</div>

## Why

In the spirit of Railway, Coolify and Dokploy, but small and shaped for one
organization. One Bun process serves the panel, another runs the builds; both share a SQLite
file. No Kubernetes, no external database, no agents to install.

## Features

| Area        | What it does                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Deploys** | Build the exact commit from GitHub, on push or by hand. Zero-downtime switch after a health check, rollback and retry. |
| **GitHub**  | One-click GitHub App: pick repositories from a list, clone private ones and get pushes without per-repo webhooks.      |
| **Logs**    | Live build and runtime logs with search, level filter and jump to the first error.                                     |
| **Metrics** | CPU and memory per container and for the host, with history.                                                           |
| **Config**  | Variables and secrets (AES-256-GCM), applied to the running app as soon as they are saved.                             |
| **Volumes** | Folders kept between deploys as Docker named volumes, with detach and an explicit delete of the data.                  |
| **Domains** | Automatic and custom domains, HTTPS by Let's Encrypt through Traefik, and a live check of each domain's DNS.           |
| **Ops**     | Daily database backups, encrypted off-site copies to any S3 bucket, and Discord or Slack alerts.                       |
| **Servers** | Add a VPS with one pasted command; builds and apps run there over a persistent SSH connection, moves keep sites up.    |
| **Tasks**   | Commands that run inside the app container, on demand or on a cron schedule.                                           |
| **Team**    | Admin, developer and viewer roles, API tokens, an MCP server for AI clients and an audit log.                          |

<table>
  <tr>
    <td><img src="docs/images/deploy.png" alt="Deploy detail with stages and logs" /></td>
    <td><img src="docs/images/logs.png" alt="Live runtime logs" /></td>
  </tr>
</table>

## Quick start

Requires Linux with [Bun](https://bun.sh) 1.4+, git and Docker 23+.

```bash
bun install
bun run setup    # writes .env with generated secrets
bun run dev      # panel on http://localhost:3000; the first visit creates the admin
bun run worker   # in another terminal: builds, tasks, metrics, backups
```

## Production

Docker Compose starts Traefik, the panel and the worker. Only the worker can reach the Docker socket.

```bash
bun run setup        # then set PUBLIC_URL, PANEL_DOMAIN and ACME_EMAIL in .env
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" >> .env
docker compose up -d --build   # then open PUBLIC_URL and create the admin
```

## Development

```bash
bun run check        # format, lint, types, unused code and tests
bun run ui:review    # screenshots of every screen plus an accessibility report
```

Built with Bun, TanStack Start, React, Tailwind, Drizzle, Better Auth and Traefik.

The full guide (architecture, GitHub App, MCP, backup, troubleshooting) is in
[docs/guia.md](docs/guia.md), in Portuguese.
