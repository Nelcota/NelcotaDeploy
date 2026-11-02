<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/nelcota-logo-white.svg" />
  <img src="public/nelcota-logo-black.svg" alt="Nelcota" width="220" />
</picture>

<h3>Nelcota Deploy</h3>

<p>Self-hosted deploy panel for Linux VPSs with Docker: one server or many over SSH.<br />
Push to GitHub, get a running container with logs, metrics, uptime checks and HTTPS.</p>

<p>
  <a href="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml"><img alt="Check" src="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml/badge.svg" /></a>
  <img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-black?logo=bun" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/database-SQLite-003b57?logo=sqlite&logoColor=white" />
</p>

<img src="docs/images/dashboard.png" alt="Nelcota Deploy dashboard with application status, server usage and recent activity" width="900" />

</div>

## Why

Like Railway, Coolify and Dokploy, but smaller and built for a single organization. One Bun process serves the panel, another runs the builds; both share a SQLite
file. No Kubernetes, no external database, no agents to install.

## Features

| Area          | What it does                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deploys**   | Build the exact commit from GitHub, on push or by hand, from a Dockerfile, with Railpack or from a Docker Compose file. Zero-downtime switch (Dockerfile and Railpack), rollback, retry and the deploy status on GitHub. New projects deploy once an admin approves them. |
| **Rollback**  | When a new version passes its health check but falls into a restart loop in the minutes after the switch, the panel goes back to the previous one by itself and sends an alert.                                                                                           |
| **Replicas**  | Up to 10 copies of an app behind Traefik's load balancer, all health checked before the switch.                                                                                                                                                                           |
| **Staging**   | A staging environment per project, with its own address and variables, and promotion of its live commit to production.                                                                                                                                                    |
| **Previews**  | Optional: up to 5 open pull requests to the project's branch each get a temporary address; forks never run.                                                                                                                                                               |
| **GitHub**    | One-click GitHub App: pick repositories from a list, clone private ones and get pushes without per-repo webhooks.                                                                                                                                                         |
| **Logs**      | Live build and runtime logs with search, level filter, jump to the first error, copy and download. Start, stop and restart the app from the panel.                                                                                                                        |
| **Metrics**   | CPU and memory per container and for the host, with history.                                                                                                                                                                                                              |
| **Config**    | Variables and secrets (AES-256-GCM), applied on save by restarting the app, or rebuilding it for build-time variables.                                                                                                                                                    |
| **Volumes**   | Folders kept between deploys as Docker named volumes, which can be detached; their data is deleted only on request.                                                                                                                                                       |
| **Databases** | PostgreSQL, MySQL, MongoDB and Redis per project, with the URL in a secret variable, and daily encrypted backups with restore (all but Redis).                                                                                                                            |
| **Limits**    | Optional memory and CPU limits per application container.                                                                                                                                                                                                                 |
| **Domains**   | Automatic and custom domains, HTTPS by Let's Encrypt through Traefik, and a live check of each domain's DNS.                                                                                                                                                              |
| **Uptime**    | Every live domain is checked from the outside each minute, with availability and response time history, an alert when it goes down and a warning two weeks before its certificate expires.                                                                                |
| **Console**   | One-off commands in the live container from the browser, with the output as it runs. Available to anyone allowed to deploy the project, and each command goes to the audit log.                                                                                           |
| **Tasks**     | Commands that run inside the app container, on demand or on a cron schedule.                                                                                                                                                                                              |
| **Servers**   | Add a VPS with one pasted command; builds and apps run there over a persistent SSH connection, and moving a project to another server keeps its sites online. Build cache and dangling images are cleaned daily on each one.                                              |
| **Ops**       | Daily panel backups, encrypted off-site copies to any S3-compatible bucket (S3, R2, B2), and Discord or Slack alerts for failed deploys and backups, automatic rollbacks, apps, databases, domains or servers down and disks over 85% full.                               |
| **Team**      | Admin, developer and viewer roles; projects visible only to their members, each a manager, developer or viewer there; two-factor authentication, API tokens, an MCP server for AI clients and an audit log.                                                               |

<table>
  <tr>
    <td><img src="docs/images/project.png" alt="Project overview with status, resources and recent deploys" /></td>
    <td><img src="docs/images/logs.png" alt="Live runtime logs with warnings and errors highlighted" /></td>
  </tr>
  <tr>
    <td><img src="docs/images/domains.png" alt="Domains with uptime history and certificate expiry" /></td>
    <td><img src="docs/images/console.png" alt="Console with the output of commands run in the container" /></td>
  </tr>
</table>

## Quick start

Requires Linux with [Bun](https://bun.sh) 1.4+, git and Docker 23+ with the buildx and compose
plugins; Railpack builds also need [Railpack](https://railpack.com) installed.

```bash
bun install
bun run setup    # writes .env with generated secrets
bun run dev      # panel on http://localhost:3000; the first visit creates the admin
bun run worker   # in another terminal: builds, tasks, metrics, uptime checks, backups
```

## Production

Docker Compose starts Traefik, the panel and the worker. The panel never touches the Docker
socket: the worker uses it, and Traefik only reads it.

```bash
bun run setup        # then set PANEL_DOMAIN and ACME_EMAIL in .env
sed -i "s/^DOCKER_GID=.*/DOCKER_GID=$(stat -c %g /var/run/docker.sock)/" .env
docker compose up -d --build   # then open https://PANEL_DOMAIN and create the admin
```

## Development

```bash
bun run check        # format, lint, types, unused code, package size and tests
bun run ui:review    # screenshots of every screen plus an accessibility report
```

Built with Bun, TanStack Start, React, Tailwind, Drizzle, Better Auth and Traefik.

The full guide (architecture, GitHub App, MCP, backup, troubleshooting) is in
[docs/guia.md](docs/guia.md), in Portuguese.
