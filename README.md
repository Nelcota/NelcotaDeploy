<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/nelcota-logo-white.svg" />
  <img src="public/nelcota-logo-black.svg" alt="Nelcota" width="220" />
</picture>

<h1>Nelcota Deploy</h1>

<p>Deploy Docker applications from GitHub to your own Linux VPS.<br />
Manage deployments, logs, uptime, and HTTPS from a single panel.</p>

<p>
  <a href="#install-on-a-vps">Install on a VPS</a> ·
  <a href="https://github.com/Nelcota/NelcotaDeploy/releases/latest">Latest release</a> ·
  <a href="https://github.com/Nelcota/NelcotaDeploy/pkgs/container/nelcotadeploy">Public container image</a>
</p>

<p>
  <a href="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml?query=branch%3Amain"><img src="https://github.com/Nelcota/NelcotaDeploy/actions/workflows/check.yml/badge.svg?branch=main" alt="CI status on main" /></a>
</p>

</div>

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

### Update an installer-managed panel

Download, verify, and extract the newer release in an empty directory using the steps above. Use
`sudo bash nelcota-deploy/install.sh --update` as the final command. The updater downloads
the release images, briefly stops the panel and worker, and saves SQLite and the installed
configuration before the new image runs migrations. It preserves the existing Docker volumes,
administrator, and secrets. Allow for a short interruption while the panel restarts.

The updater prints the root-only backup directory under `/opt/nelcota-deploy/update-backups`.
It keeps that backup if the update fails. To retry, rerun `--update` from the same release.
Running the command again after a successful update reports that the release is already installed.

#### Restore the previous release

Use the backup directory printed by the updater. Restoring SQLite returns panel data to its
pre-update state, so changes made after that snapshot will be lost. Run the following as root,
with no installer or updater running:

```bash
(
  set -eu
  cd /opt/nelcota-deploy
  backup=/opt/nelcota-deploy/update-backups/REPLACE_WITH_BACKUP_DIRECTORY
  exec 9< .
  flock -n 9
  test -s "$backup/nelcota.db"
  docker compose stop web worker
  install -m 0600 "$backup/docker-compose.yml" docker-compose.yml
  install -m 0600 "$backup/docker-compose.override.yml" docker-compose.override.yml
  install -m 0644 "$backup/deploy/traefik/panel.yml" deploy/traefik/panel.yml
  install -m 0600 "$backup/.env" .env
  previous_image=$(docker compose config --environment | sed -n 's/^NELCOTA_IMAGE=//p')
  test -n "$previous_image"
  docker run --rm -i --pull=never --network none \
    --mount type=volume,source=nelcota_data,target=/data --entrypoint sh "$previous_image" -ec '
    umask 077
    cat > /data/nelcota.db.restore
    test -s /data/nelcota.db.restore
    rm -f /data/nelcota.db-wal /data/nelcota.db-shm
    mv -f /data/nelcota.db.restore /data/nelcota.db
  ' < "$backup/nelcota.db"
  docker compose up --wait --no-build web
  docker compose up -d --no-build worker
  docker compose up -d --no-build --force-recreate traefik
  rm -f update-backups/pending
)
```

## Deploy your first application

1. Create a project from a GitHub repository. Connect the GitHub App for private repositories and
   deployments on push, or paste the HTTPS URL of a public repository to deploy manually.
2. Select the branch and build method. Nelcota Deploy supports a Dockerfile, Railpack, or Docker
   Compose. Configure the application's internal port, health check, and environment variables.
3. Start a deployment and follow the build logs. Once the app is running, add a domain and point
   its DNS to the server that runs the application.

Projects created by developers need an administrator's approval before they can deploy. See the
[GitHub App setup](docs/guia.md#github-app-recomendado) for repository permissions and webhooks.

![Project overview showing the production and staging tabs, application health, and the deployed commit](docs/images/project.png)

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
