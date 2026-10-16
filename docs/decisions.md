# Technical decisions

## October 15, 2026 — Canonical plan

The original checkout contained the system plan, but no repository instructions or separate implementation plan. That document remains the architectural source and is now available in English as [system-plan.md](system-plan.md). Current agent guidance is in [AGENTS.md](../AGENTS.md).

## Initial scope

Version 1 requires a Dockerfile; automatic detection waits for audited templates. Admin and member roles are supported. Remote `exec` is excluded. Control uses bidirectional ConnectRPC over HTTP/2, superseding the early roadmap's WebSocket reference.

## Security and operational boundaries

- Sessions last one hour. Passkeys require user verification. Configured TOTP is mandatory before session issuance. User and server invitations are separate; there is no public signup or default password.
- Public APIs listen on loopback behind Caddy. RPC uses a separate WireGuard-address listener with mTLS. X-Forwarded-For is accepted only from loopback, assuming Caddy overwrites external headers.
- Audit writes share domain-mutation transactions; SQLite triggers reject UPDATE/DELETE. Root access to the database is outside this guarantee.
- An encrypted swap intent is persisted before route changes. Old containers remain journaled until removal. Heartbeats report observed versions to repair lost terminal events. Command-ID replay history survives restarts.
- Runtime UID/GID is always 65532, rootfs is read-only, and `/tmp` is bounded. Additional writable storage requires an explicit future decision; do not automatically relax isolation.
- Build concurrency defaults to one. Administrators may choose two for larger VPS instances at enrollment; no unmeasured automatic tuning.

## Supply chain and installers

No production release/domain/key identity existed in the initial material. Installers require an HTTPS release URL and a Minisign key distributed through a trusted channel. They verify signed SHA-256 manifests before installing binaries. BuildKit daemons are included in the signed bundle; maintainers must verify their provenance first. GoReleaser is prepared; `scripts/release.sh` packages and signs locally without publishing.

Installers refuse existing Caddy/WireGuard configuration, require tested SSH key access, preserve data, and do not upgrade active installations. Real-system acceptance follows the [VPS guide](vps-testing.md).

## Measured zstd optimization

On a Ryzen 7 9700X with Go 1.26.9 and `/tmp`, a new encoder per line cost 29,070 ns/op, 644,586 B/op, and 22 allocs/op. Encoder/buffer pooling measured 1,437 ns/op, 298 B/op, and five allocs/op while preserving concatenated frames and round-trip correctness. Optimization followed measurement; it does not establish VPS latency or memory performance.

## Verified technical references

- [Connect protocol and HTTP/2 requirement for bidirectional streams](https://connectrpc.com/docs/protocol/).
- [Caddy API: PATCH, POST, IDs, persistence, and concurrency](https://caddyserver.com/docs/api).
- [Official Go distributions](https://go.dev/dl/): downloaded Go 1.26.9 was checked against its published checksum.

## Vulnerability-driven dependency updates

Initial govulncheck v1.9.0 analysis reported 25 dependency-symbol findings. Updates included BuildKit v0.34.0, maintained Moby client module `github.com/moby/moby/client` v0.6.2, API v1.56.1, containerd, gRPC, x/net, OpenTelemetry, and related dependencies. The driver uses `fsutil.FS` instead of removed BuildKit LocalDirs. fsutil and containerd/errdefs come from the official APIs.

Repeated analysis found zero reachable-symbol or imported-package vulnerabilities, with one required-module warning lacking an import/call path. Exact versions are recorded in go.mod/go.sum. Installers use Docker's official apt repository with a pinned signing fingerprint, not get.docker.com. References: [Debian](https://docs.docker.com/engine/install/debian/), [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## Queue, logs, and UI boundaries

- Check runs use a SQLite outbox and retry worker. Slow GitHub calls do not block agent heartbeat/log handling. Installation-token transport is covered by simulated HTTP tests.
- Environment updates patch individual keys with explicit deletion. Frontends can update secrets without reading/resending existing values. Aggregate limits stay below protocol bounds.
- API tokens enforce service-level scopes, a maximum 30-day lifetime, stored hashes, and revocation. New tokens require recent interactive authentication; bearer tokens cannot mint broader tokens.
- Log rings are bounded by count and bytes (1 MiB per deployment). Transport reserves status/heartbeat capacity. Saturated logs do not cancel builds. Browser streams are ephemeral and need snapshot reload after reconnection.
- BuildKit cache GC independently enforces seven-day age and total-size limits, so recent cache cannot exceed the size cap indefinitely.

## Acceptance and integration

Eight implementation milestones were prioritized. Full pipeline/installer acceptance requires VPS infrastructure. Docker was initially unavailable, then became available; real integration passed. Operational extensions—remote backups/restore/update and base-image jobs—were subsequently implemented. Infrastructure acceptance remains required for production.

Integration uses application bridges without published ports. Test Caddy uses host networking with loopback listeners, matching production's native proxy. Test BuildKit requires explicit OCI privilege in HostConfigModifier because that modifier replaces legacy defaults. Only the test builder is privileged. Applications are inspected for non-root, unprivileged, cap-drop ALL, read-only rootfs, CPU/RAM limits, and no port bindings. Tests exercise real traffic during route swaps and cleanup of old containers/images.

## Operations and memory after profiling

- RSS overhead came mainly from WASM compiler scratch space. One startup `debug.FreeOSMemory` call preserves the driver/query pool. Agent telemetry descriptors are warmed first; default GOGC=50 honors overrides. Both systemd services set `GODEBUG=disablethp=1` for small heaps, following the [Go guide](https://go.dev/doc/gc-guide#Linux).
- Backups use VACUUM INTO, streaming tar, bounded AES-GCM blocks, per-file keys, and authenticated completion. The independent backup key is excluded from tar and supplied separately during restore. Integrity/encrypted-field validation happens before replacement; a lock and durable marker prevent partial startup.
- S3 uses HTTPS path-style PutObject with signed SigV4 payloads in the standard library. The limited operation does not require a full SDK. Tests cover an official AWS vector and local TLS uploads. Configuration comes from mode 0600 files or encrypted settings.
- Updates accept newer stable versions and prehashed ED Minisign manifests, including trusted comments. Root helpers have fixed commands/destinations and revalidate downloads. os.Root confines requests/results. Coordinators enforce idle state, order, readiness, and confirmation. Agent CLI updates reserve maintenance over mTLS.
- Certificate renewal preserves CA/identity, atomically saves new pairs, and allows seven days of retry using the previous fingerprint. Pending panel pairs are encrypted. The five-year CA does not rotate peer trust automatically.
- Metrics cap samples at 256 containers with four concurrent calls and a ten-second budget. Official Dockerfile parsing handles default ARGs without executing commands. Tagged bases are materialized in BuildKit; digest pins remain immutable.

## Public repository conventions

The repository uses MIT licensing and English for all project text and GitHub activity. Project commits are attributed to HanielCota through the account's GitHub no-reply address. Signed historical artifact identifiers remain unchanged; see the [history migration](history-migration.md).
