# NelcotaDeploy system plan

Original design: October 14, 2026 · Haniel Braga Fialho Cota. This document records design goals and options, not delivered behavior. See [status](status.md) for what is implemented and verified, and [decisions](decisions.md) for where the implementation differs.

## Vision

An open-source, self-hosted deployment platform on two VPS instances: one for the control panel, one for applications. GitHub pushes enter a queue and produce health-checked deployments managed by the panel.

Initial goals, subject to measurement:

- Push to main → running application in 10–60 seconds with dependency cache.
- Less than 300 MB of platform RAM on the deployment VPS.
- Installation in less than five minutes per VPS.
- No public control-plane port on application hosts.

Prefer simple Go binaries and SQLite without Redis/Kubernetes. Use dependency caches, queue coalescing, and low-priority builds. Apply WireGuard/mTLS, typed actions, and container hardening. Keep only running images plus bounded caches. Add previews and scale-to-zero after the core is stable.

## Architecture

The panel stores desired application state. The agent compares it with runtime state and reconciles differences. The agent initiates an outbound connection through WireGuard.

- **Control VPS:** API/UI, queue, SQLite, GitHub webhooks, and log streaming.
- **Application VPS:** agent, Docker/BuildKit, Caddy TLS/routing, and application containers.
- **Private transport:** WireGuard + mTLS and a typed, restricted command protocol.
- **Public ingress:** application HTTP/HTTPS through Caddy; panel HTTPS or private-network-only access. Installer acceptance includes IPv4/IPv6 and SSH rules.

## Technology choices

| Layer | Planned choice | Rationale / alternative |
| --- | --- | --- |
| Panel backend | Go net/http + chi | Single binary; early alternative: Bun/Hono or Echo |
| Agent | Go | Static executable with a small working set |
| Database | SQLite WAL | Low maintenance; PostgreSQL is a later scale option |
| Queue | SQLite table + Go worker | Transactional, no Redis; River if moving to PostgreSQL |
| Frontend | templ + Datastar + Tailwind CSS v4 | Server-rendered HTML, SSE; fallback htmx 2 + Alpine.js |
| Live data | Browser SSE, agent ConnectRPC | Typed bidirectional HTTP/2 and native browser event streams |
| Proxy | Caddy admin API | Automatic TLS, HTTP/3, route replacement; alternative Traefik |
| Builds | Docker + BuildKit | Cache mounts, secret providers, bounded cache GC |
| Stack detection | Dockerfile in the initial version | Railpack/Nixpacks and audited templates remain future options |
| Private networking | WireGuard | Kernel transport; Tailscale is an alternative |
| Authentication | Passkeys/WebAuthn + TOTP | No password-based panel login |

## Library policy

Prefer the standard library. Add external libraries where they replace substantial work; optimize only after profiling. The original candidate catalog is broader than the implemented dependency set; go.mod is authoritative.

| Need | Candidate / selected family |
| --- | --- |
| Routing/templates | net/http, go-chi/chi, a-h/templ |
| Panel-agent protocol | connectrpc/connect-go, planetscale/vtprotobuf |
| SQLite/queries/migrations | ncruces/go-sqlite3, sqlc-dev/sqlc, pressly/goose |
| Build/runtime | moby/buildkit and official Moby clients |
| GitHub | google/go-github, bradleyfalzon/ghinstallation |
| Passkeys/TOTP | go-webauthn/webauthn, pquerna/otp |
| Encryption | crypto/aes, crypto/cipher, golang.org/x/crypto |
| WireGuard | golang.zx2c4.com/wireguard/wgctrl |
| Concurrency | golang.org/x/sync/errgroup; sourcegraph/conc was considered |
| Metrics | shirou/gopsutil, VictoriaMetrics/metrics |
| Compression/logging/rate limits | klauspost/compress, log/slog, golang.org/x/time/rate |
| CLI/testing | spf13/cobra, testify, testcontainers-go, goleak |
| Optional profile-driven choices | otter cache, xxh3, sonic JSON, zombiezen SQLite |
| Other originally considered helpers | go-playground/validator, koanf |

Use the native git executable rather than go-git for shallow clones. Embedding Caddy in the agent was considered, but would couple proxy updates to agent releases. The current implementation keeps them separate.

Frontend candidates: templ, Datastar, Tailwind v4, Basecoat, Lucide SVG icons, uPlot metrics, and xterm.js logs. The target is embedded, precompressed assets, immutable hashed caching, and less than 100 KB of JavaScript. The interface uses this stack. GoReleaser covers multi-architecture build configuration; signed updater distribution uses Minisign in the implementation.

## Go performance approach

Use a pinned modern toolchain, CPU-appropriate builds, automatic PGO, bounded allocations, and measurements before/after each optimization.

- Keep Go version aligned in go.mod and CI. Go 1.26 introduced Green Tea GC; consult [release notes](https://go.dev/doc/go1.26) for runtime details.
- Collect representative production CPU profiles before committing default.pgo. Do not fabricate a profile.
- Build amd64 v1/v3 and arm64 variants; installers select compatible amd64 features.
- Use trimpath, reduced ldflags, and CGO_ENABLED=0 for distributed executables.

```bash
GOAMD64=v3 CGO_ENABLED=0 go build -pgo=auto -trimpath -ldflags="-s -w" ./cmd/nelcota-agent
```

Set GOMEMLIMIT relative to systemd MemoryMax; GOMAXPROCS follows cgroup CPU limits. Adjust GOGC only with measurements. The implemented agent default of 50 follows profiling and respects overrides.

Hot paths use bounded deployment rings, buffered fan-out, pooled zstd encoders/buffers, reusable byte slices, buffered writes, io.Copy where useful, context cancellation, and bounded errgroup concurrency. Agent streams are uncompressed on the private network; vtprotobuf reduces reflection/allocation costs.

SQLite uses WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON, one writer, a read pool, generated statements, and transactional batches. Tune cache_size/mmap_size to database needs. HTTP uses ReadHeaderTimeout, IdleTimeout, keepalive, and Caddy. pprof/flight recorder bind privately. Benchmarks use b.Loop and benchstat.

## Components and deployment flow

The panel validates HMAC webhooks, persists desired state, schedules/coalesces work, authorizes API/UI operations, and forwards agent events through SSE. The agent reconnects over mTLS, executes typed actions, reconciles every ten seconds, and reports host/container telemetry. The builder uses temporary exact-SHA clones and BuildKit resource controls. Caddy terminates TLS and routes domains to containers through its loopback admin API.

Deployment sequence:

1. Receive a GitHub push webhook and validate HMAC/branch.
2. Create a queued deployment; cancel any older queued deployment for that app.
3. Schedule when no deployment is active for that app and the server has a free build slot.
4. Use temporary GitHub App credentials and clone the exact SHA into a temporary directory.
5. Build through BuildKit with cache, secret providers, bounded resources, and streamed logs.
6. Start a hardened candidate on the application network and wait for its healthcheck (default 60 seconds).
7. On success, switch Caddy upstreams, drain/stop the old container, and remove its image. On failure, remove the candidate and retain the old route.
8. Persist/report terminal status and publish the exact-SHA GitHub check through the outbox. Send a notification if the deployment failed.

One active deployment per app; configurable bounded build concurrency per server. Defaults remain conservative, and larger-host settings are explicit. Only the latest queued SHA survives coalescing. Cancellation stops build/clone/streams and cleans temporary state. Manual deployment/rollback has priority over automatic work.

States: queued → building → starting → success | failed | cancelled.

## Cache and storage

| Data | Retention |
| --- | --- |
| Source checkout | Temporary build directory, deleted on success/failure |
| Running image | Required while its containers run |
| Previous image | Removed after committed route replacement and cleanup |
| BuildKit cache | Default 5 GiB per server, seven-day unused age and independent size cap |
| Build logs | Last 50 completed deployments per app on the panel, compressed |

Application rollback rebuilds a previous SHA rather than retaining every image. Fast Dockerfiles copy lockfiles before code and use appropriate cache mounts. Build secrets use secret mounts, never ARGs/layers. Weekly base refresh materializes tagged bases; digest pins stay immutable. The panel API exposes cache settings, prune, and clean builds. Build cgroups must be accepted under realistic app load before claiming isolation performance.

## Protocol and reconciliation

The Protobuf/ConnectRPC contract defines typed actions with command IDs, validity, signatures, identity checks, and persistent replay protection. Deployment, cancellation, start/stop/restart/scale, desired configuration, log follow, metrics, and pruning are bounded operations. Rollback schedules a new deployment of a prior SHA. The early optional remote-exec idea was rejected; current protocol/API exposes no shell/exec.

Agent events include deploy_log, deploy_status, container_event, metrics (15-second cadence), and heartbeat (five seconds). Desired-state reconciliation runs every ten seconds and after reconnect to repair missing containers/routes and stale configuration. See the actual [Protobuf](../proto/agent/v1/agent.proto) and [frontend contract](frontend-contract.md) for supported operations.

## Security layers

| Layer | Planned/implemented controls |
| --- | --- |
| Network | WireGuard between hosts, private control bindings, key-only SSH, reviewed public port rules |
| Docker/firewall | No app port publishing; app bridges and dedicated forwarding controls |
| Panel-agent | Internal CA, per-server mTLS, signed commands, one-use 15-minute enrollment |
| Actions | Fixed action list, authorization, explicit destructive-operation confirmation |
| Containers | Non-root, no-new-privileges, cap-drop ALL, per-app network, CPU/RAM/PID limits, no Docker socket mounts |
| Secrets | AES-256-GCM, private master key, separate runtime/build injection, masked logs |
| Login | Passkeys/TOTP, rate limiting, Secure/HttpOnly/SameSite Strict cookies, short sessions |
| GitHub | Installation tokens and constant-time HMAC validation |
| Audit | Transactional append-only application rules; root remains outside the guarantee |
| Host | systemd sandboxing, SSH hardening, unattended updates, fail2ban/CrowdSec options |
| Supply chain | Signed manifests and checked binaries at installation/update |

## Planned interface and data model

Six initial screens: dashboard, app deployments, build/runtime logs, app configuration, servers, and settings. Show status, exact SHA, author, stage durations, resource usage, cache status, health configuration, domains, secrets, replicas, users, GitHub integration, backups, and audit as appropriate. Offer explicit deploy/cancel/rollback/prune/start/stop actions. Planned UX includes command navigation, responsive light/dark themes, and measured stage timing rather than invented progress.

Core SQLite entities: users, credentials, servers, apps, domains, env_vars, deployments, audit_log. Deployment rows form the queue with app/status indexes. Logs are external zstd files. Additional operational/token/recovery/certificate tables are defined by current migrations, not limited to the original eight-table sketch.

## Installation and operations

Reviewed installers target separate Debian 12+/Ubuntu 22.04+ VPS instances, establish service users, Caddy, WireGuard, signed binaries, systemd sandboxing, and initial invitation/CA/master keys. Agent installation also configures Docker/BuildKit and bounded build resources. Invitations are one-use and last 15 minutes; secret invitation tokens are supplied through private files, not process arguments. The [VPS guide](vps-testing.md) contains the executable procedure; no production install URL is invented here.

GitHub App Manifest establishes panel integration. Signed updates are coordinated one agent at a time with the panel last. Daily consistent encrypted backups support local/S3 storage and offline recovery with an independent key. Uninstall preserves data by default; purge is explicit. Download-and-review installation is preferred for inspection; a signed .deb remains a future option.

## Phase 2

After core production acceptance: PR preview domains/cleanup, post-deploy health rollback based on errors/latency, scale-to-zero with request wakeup, Telegram/WhatsApp notifications (webhook and email notifications already ship), optional repository configuration, background Trivy scanning, committed-secret detection, and continuous SQLite replication through Litestream. These are proposals, not current supported features.

## Performance targets

Representative target VPS: 2–4 vCPUs, 4–8 GB RAM, NVMe. All targets need real measurements.

| Metric | Target | Measurement |
| --- | --- | --- |
| Idle panel RSS | ≤60 MB | Process/service metrics |
| Idle agent RSS | ≤25 MB | Process/service metrics |
| Webhook to queued | <1 second | Webhook timestamp vs queued_at |
| Shallow clone | <5 seconds, medium repository | clone stage duration |
| Cached Node deployment | 15–40 seconds | Total duration |
| Cached Go deployment | 5–15 seconds | Total duration |
| Start + health + route switch | 2–10 seconds | Stage durations |
| Lost requests during deployment | 0 | Representative traffic, including long requests |
| Proxy overhead | <1 ms/request | Direct vs Caddy comparison |
| Full installation | <5 minutes/VPS | Timed installation |

Slow storage, poorly ordered Dockerfiles, and heavy builds on small-memory VPS instances can dominate timings. Use bounded build concurrency, suitable memory limits/swap, stage timings, and cache measurements to investigate.

## Risks and decisions

Memory exhaustion needs build cgroups and conservative concurrency; disk exhaustion needs bounded caches/pruning and usage alerts. Panel downtime stops new control work while applications continue on the last desired state. Master-key loss makes encrypted values unrecoverable without coordinated backup/key storage. Rebuilding old SHAs makes rollback slower; retaining one prior image is a possible future option. Scope growth must not delay core acceptance.

Resolved choices: MIT license, Dockerfile-only initial builds, admin/member roles, templ/Datastar/Tailwind UI direction, English-only repository content, and public source under Nelcota/NelcotaDeploy. Production domain, signing identity/distribution, real-device authentication, and private-only versus public panel exposure remain deployment decisions.
