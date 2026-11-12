# Nelcota Deploy

Nelcota Deploy is a self-hosted panel for deploying Docker applications from GitHub to Linux VPSs.
Use one server for the panel and your applications, or run workloads on additional servers over SSH.
The panel tracks deployments, logs, resource usage, and uptime, and manages HTTPS for your domains.

[Latest release](https://github.com/Nelcota/NelcotaDeploy/releases/latest) ·
[Public container image](https://github.com/Nelcota/NelcotaDeploy/pkgs/container/nelcotadeploy)

## Install on a VPS

- Use an `amd64` or `arm64` Linux VPS with sudo access and `curl`, `tar`, and `sha256sum`.
- Point a hostname such as `deploy.example.com` at the VPS. Make inbound TCP ports 80 and 443
  reachable and available for Traefik.
- On supported Ubuntu and Debian releases, the installer sets up Docker Engine and Compose if
  Docker is absent. An existing Docker installation needs the Compose plugin.

Run this from an empty directory on the VPS:

```bash
curl -fSLO --retry 3 https://github.com/Nelcota/NelcotaDeploy/releases/latest/download/nelcota-deploy.tar.gz &&
curl -fSLO --retry 3 https://github.com/Nelcota/NelcotaDeploy/releases/latest/download/nelcota-deploy.tar.gz.sha256 &&
sha256sum -c nelcota-deploy.tar.gz.sha256 &&
tar -xzf nelcota-deploy.tar.gz &&
sudo bash nelcota-deploy/install.sh
```

Enter the panel hostname and administrator email when prompted. For unattended installation,
pass `--domain deploy.example.com --email admin@example.com` to `install.sh`.

The installer pulls the public image from GHCR by digest, creates the first administrator before
exposing the panel, and verifies HTTPS. Open the URL printed by the installer and read the initial
password with `sudo cat /opt/nelcota-deploy/initial-admin-password`. Remove that file after signing in.

If installation stops with an error, fix the reported issue and rerun the same command. The
installer reuses the saved configuration, image, and volumes. Manage an existing manual Compose
installation from its original checkout.

## Deploy your first application

1. Create a project from a GitHub repository. Connect the GitHub App for private repositories and
   deployments on push, or paste the HTTPS URL of a public repository to deploy manually.
2. Select the branch and build method. Nelcota Deploy supports a Dockerfile, Railpack, or Docker
   Compose. Configure the application's internal port, health check, and environment variables.
3. Start a deployment and follow the build logs. Once the app is running, add a domain and point
   its DNS to the server that runs the application.

Projects created by developers need an administrator's approval before they can deploy. See the
[GitHub App setup](docs/guia.md#github-app-recomendado) for repository permissions and webhooks.

## What you can manage

- **Deployments** with health-checked rollouts and rollback for Dockerfile and Railpack builds,
  load-balanced replicas, staging environments, and previews for pull requests from the same repository.
- **Applications** with live build and runtime logs, scheduled tasks, environment variables and
  encrypted secrets, custom domains, and TLS certificates through Traefik and Let's Encrypt.
- **Data** with persistent Docker volumes and managed PostgreSQL, MySQL, MongoDB, and Redis
  instances. PostgreSQL, MySQL, and MongoDB support managed backup and restore.
- **Servers and access** with local and SSH deployment hosts, CPU and memory metrics, uptime
  checks, alerts, project roles, two-factor authentication, and audit logs.

## Operate the panel

Docker Compose runs the web panel, the worker, and Traefik. The panel and worker share a SQLite
database. The worker runs deployments and jobs and is the only service with access to the Docker
socket. When a project uses an SSH server, its builds and containers run on that server.

For an installation managed by the installer, check service status and logs from the VPS:

```bash
sudo docker compose --project-directory /opt/nelcota-deploy ps
sudo docker compose --project-directory /opt/nelcota-deploy logs --tail 100 web worker traefik
```

Back up `/opt/nelcota-deploy/.env` securely with the panel database. Keep its encryption key to
restore saved secrets. The worker makes daily SQLite backups and can store encrypted copies in
S3-compatible storage. Back up application volumes and databases separately from the panel database.

See the [backup and restore guide](docs/guia.md#backup-e-restauração-do-sqlite),
[SSH server setup](docs/guia.md#vários-servidores), and
[network isolation guide](docs/network-isolation.md).

## Develop locally

Use Git and the Bun version pinned in [package.json](package.json). The worker also needs access
to Docker with the Buildx and Compose plugins. Install Railpack if you plan to test Railpack builds
outside the production containers.

```bash
bun install --frozen-lockfile
bun run setup
bun run dev
```

Open `http://localhost:3000` and create the first local administrator. Run `bun run worker` in a
second terminal to process deployments and jobs. `bun run setup` creates `.env` from
[.env.example](.env.example) and generates the local secrets on the first run.

```bash
bun run check         # Formatting, lint, types, unused code, package size, and unit tests
bun run test:docker   # Integration tests with real Docker
bunx playwright install chromium
bun run test:browser  # Browser regression tests
bun run ui:review     # Screenshots and accessibility report
```
