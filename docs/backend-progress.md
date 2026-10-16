# Backend progress

Implementation milestones were recorded on October 15, 2026 from the [system plan](system-plan.md). Checkmarks mean implemented and locally verified, not complete VPS acceptance. See the [backend report](backend-report.md) and [outstanding work](outstanding-work.md).

- [x] 1. Go toolchain, project skeleton, Makefile, and CI.
- [x] 2. Typed ConnectRPC protocol, mTLS, signatures, heartbeat, and reconnection.
- [x] 3. Agent deployment pipeline and reconciliation.
- [x] 4. SQLite, services, GitHub integration, and transactional queue.
- [x] 5. Logs, events, and zstd persistence.
- [x] 6. Authentication and server security.
- [x] 7. Installers and VPS testing guide.
- [x] 8. Benchmarks, measurements, and reports.

## Initial environment and foundation

The checkout initially contained only the plan, with no Go/Docker/ShellCheck/golangci-lint on PATH and no valid writable Git metadata. Tools were prepared locally. Verified official Go 1.26.9, static builds, goleak tests, vet, golangci-lint, and ShellCheck passed. CI includes race detection, reproducible generation, and infrastructure integration. Tools and binaries remain ignored.

## Protocol and deployment

HTTP/2 ConnectRPC/vtprotobuf and mTLS were tested with real local TLS. Ed25519 signatures, identity, validity, replay, and cancellable bidirectional shutdown are covered. Official BuildKit/Moby clients and Caddy implement exact-SHA cloning, temporary contexts, hardening, health rollback, and cancellation. Credentials stay out of argv, agent state is encrypted, no app ports are published, and route switching is the commit point.

## Services, persistence, and authentication

Real SQLite WAL, a single writer, read pool, goose, and sqlc back the services. Concurrent queue/coalescing, HMAC/delivery deduplication, invitation expiration/single use, cookies, CSRF, API-token scopes/revocation, virtual ECDSA WebAuthn, and TOTP replay tests passed. GitHub Manifest/tokens/check runs use a durable retry outbox; real GitHub credentials remain an external acceptance step.

The bounded hub disconnects slow consumers; deployments have log rings and zstd retention for 50 completed entries. Secrets use per-app/key AAD and fragmented-secret masking. Audit triggers reject UPDATE/DELETE. Diagnostics bind only to a configured private interface address.

## Installers, performance, and real integration

Shell installers include systemd services, dedicated firewall rules, WireGuard, enrollment, and Minisign/SHA-256 verification. ShellCheck passed. Native Caddy v2.10.2 was checked against its official SHA-512 and tested for route creation/replacement/deletion. Race detection passed.

When Docker became available, complete real integration passed: BuildKit, hardened bridge containers, Caddy traffic during swaps, invalid healthchecks preserving production, old container/image removal, agent telemetry over mTLS, and base-image prewarming. Installer syntax passed in Debian 12 and Ubuntu 22.04 containers. No missing-infrastructure skips were treated as passes. Real VPS/systemd/firewall/WireGuard and production performance remain separate.

Benchmarks use `b.Loop()`, benchstat comparisons, ten-target measurement scripts, stage timing, pprof, and a private flight recorder. zstd pooling followed measurement. Missing target measurements remain pending.

## Operational extensions completed

- [x] Daily/manual encrypted backups, S3, retention, and independent key.
- [x] Offline restore with locks, integrity/master-key checks, and interruption recovery.
- [x] Signed updates, fixed helper, durable queue, readiness/confirmation, rollback, and uninstall.
- [x] One-use recovery codes and TOTP reset.
- [x] Certificate renewal and WireGuard-peer restoration.
- [x] API-configurable limits/cache through agent snapshots.
- [x] Container metrics and weekly BuildKit base refresh.
- [x] Automatic slow-deploy traces when diagnostics are enabled.

Profiling reduced warmed panel memory from about 119 to 50 MiB, with 46.7–53.5 MiB after API backup. The real agent improved from 32 to 24.6–25.0 MiB after startup/GC/THP changes. These local scenarios and limitations are documented in [operations](backend-operations.md).

## Final security review

Private reads validate descriptors, types, permissions, and sizes; locks reject multiple links. Certificate rotation is serialized. Restore is confined to target roots, rejects future schemas/broken references/invalid encrypted certificates, shares creation limits, and preserves service ownership. Updates bind readiness to the validated version and roll back on persistence failure.

Authentication is transactional across challenge, passkey counter, TOTP/recovery, and session issuance; failures consume challenges without partial mutations. TOTP activation revokes old access. SSE revalidates credentials on heartbeat. Enrollment rejects reused WireGuard keys and incompatible cache limits. Regression tests cover these cases, including concurrency and interrupted operations.
