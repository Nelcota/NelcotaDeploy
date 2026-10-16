# Backend report — October 15, 2026

The backend supports frontend development through two Go binaries. templ/Datastar/Tailwind UI implementation remains outstanding. This is not a production-approved release. Local operational implementation is complete; external infrastructure and credential requirements are listed in [outstanding work](outstanding-work.md), with commands in [operations](backend-operations.md).

## Run locally

Use Go 1.26.9, Make, protoc 36.1, and ShellCheck. `make tools` installs generators, sqlc, golangci-lint, and benchstat.

```bash
make tools generate build test lint
make dev-seed
make dev
```

Visit http://127.0.0.1:8080. The web page is a placeholder; APIs and SSE are available. POST `{}` to `/api/dev/session` with Origin http://127.0.0.1:8080, then GET `/api/session` for CSRF. Development includes three sample apps, servers, deployments, and logs, with simulated cancellation/events. Data lives in ignored `.local/dev`.

`bin/nelcota-panel dev` runs an existing local build without recompilation. Historical tool paths in these reports describe that validation machine and are not part of the checkout. See the [frontend contract](frontend-contract.md) for methods, DTOs, authorization, authentication, tokens, streams, and a handler example.

## Milestone status

| Milestone | Status | Delivery and acceptance boundary |
| --- | --- | --- |
| 1. Foundation | Complete | Monorepo, Go 1.26, static builds, automatic PGO, Makefile, CI, reproducible generators, lint, goleak |
| 2. Protocol | Implemented | Protobuf/vtprotobuf, bidirectional HTTP/2 ConnectRPC, CA, mTLS, signatures, persistent replay, heartbeat, timeout, reconnection; tested with real local TLS |
| 3. Deployment pipeline | Partial acceptance | Official BuildKit/Moby clients, exact-SHA Git, hardening, healthchecks, swap, encrypted journal/reconciliation; doubles and real Docker/BuildKit/Caddy passed; VPS/WireGuard/build cgroups still require acceptance |
| 4. Panel backend | Implemented | SQLite WAL, single writer, read pool, goose/sqlc, services/DTOs, concurrent coalescing queue, HMAC/deduplication, GitHub App/check-run outbox/retry; GitHub tested with simulated transport |
| 5. Logs/events | Complete with boundaries | 1 MiB deployment rings, bounded transport, nonblocking hub, SSE, runtime logs, host/container metrics, zstd retention; no lossless/replay guarantee during saturation/reconnection |
| 6. Security | Core implemented | Virtual-authenticator WebAuthn/TOTP/recovery/reset, cookies/CSRF/rate limits, AES-GCM/AAD, scopes, invitations, audit, masked logs; real devices/infrastructure pending |
| 7. Installers | Partial acceptance | Signed/checksummed scripts, systemd, WireGuard, firewall, hardening; ShellCheck and Debian/Ubuntu syntax passed; root installation/reboot and official binary publication pending |
| 8. Performance | Partial | Benchmarks, ten-target script, CI comparison, stage timing, private diagnostics, locally investigated memory; production targets/VPS acceptance pending |

Progress checkmarks mean implementation, not production acceptance. The original checkout had no valid Git metadata and no AGENTS.md; Git history was initialized during development. Current repository guidance is in [AGENTS.md](../AGENTS.md). Public history has since been normalized to English and attributed to HanielCota; [provenance mapping](history-migration.md) preserves original build identifiers.

## Recorded validation

- Static `make build` passed for panel and agent with CGO disabled, trimpath, reduced ldflags, and automatic PGO. Linux arm64 cross-compilation passed.
- `make test` passed, including eight concurrent queue claimers, HMAC/delivery deduplication, permissions, encryption, audit triggers, scopes/revocation, invitation expiration/single use, virtual ECDSA WebAuthn/origin rejection, TOTP replay, cancellation, health, and state recovery.
- `make lint` passed: formatting including integration sources, vet with/without integration tags, golangci-lint v2.11.3 with zero issues, and ShellCheck v0.11.0.
- `CGO_ENABLED=1 go test -race -count=1 -timeout=180s ./...` passed. Concurrent components use goleak.
- `make check-generated` passed locally. CI requires the same protoc 36.1 compiler as the committed generator headers; using the distribution's older compiler changes version metadata and is rejected.
- Native Caddy v2.10.2, verified against its official SHA-512, passed route creation/replacement/deletion and upstream checks.
- Full integration passed after Docker became available. Testcontainers exercised real BuildKit v0.34.0, Docker, Caddy, bridge routing, runtime hardening, invalid-health candidate rejection, swaps under continuous short-request traffic without observed losses, and old image/container cleanup. Installer syntax passed in Debian 12 and Ubuntu 22.04. No infrastructure absence was converted to a passing skip.
- Development HTTP smoke passed login, app reads, CSRF rejection, deployment to success, zstd logs, cancellation to cancelled, and runtime SSE. Test processes were stopped afterward.
- govulncheck v1.9.0 found no reachable-symbol/imported-package vulnerabilities after updates. A required-module OpenPGP warning remained without an imported package path.

The initial report predated GitHub publication. Source and CI now live at [Nelcota/NelcotaDeploy](https://github.com/Nelcota/NelcotaDeploy); consult [Actions](https://github.com/Nelcota/NelcotaDeploy/actions) for current remote results. Multi-architecture staging packages remain local and are not official published releases.

## Local benchmarks

Ryzen 7 9700X, Linux amd64, Go 1.26.9, `b.Loop()`. These are workstation measurements, not VPS results.

| Operation | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| Hub publish without subscribers | 52.49 | 8 | 1 |
| Steady-state ring append | 11.27 | 0 | 0 |
| zstd write | 1,454 | 299 | 5 |
| AES-GCM seal | 133.1 | 96 | 4 |
| Real SQLite enqueue/coalescing/audit | 81,169 | 7,955 | 175 |

A fresh zstd encoder per line initially cost 29,070 ns/op and 644,586 B/op. Pooling encoders/buffers reduced that cost while preserving compressed round trips. The CI benchstat script rejects statistically significant regressions above 20% when a baseline exists.

SQLite WASM startup allocated approximately 100 MiB while live heap was only 9.4 MiB. A one-time release reduced warmed RSS from 119.2 MiB to about 50 MiB. The final API backup/lock/restore scenario measured panel RSS 46.7–53.5 MiB with diagnostics enabled. Agent RSS went from 32 to 27.3 MiB after startup/GC changes, then 24.6–25.0 MiB after THP service settings and two real telemetry samples, without diagnostics. See [measurement conditions](backend-operations.md#memory).

## Operational delivery

Daily/manual encrypted backups and S3 retention, offline restore with previous copies, signed executable updates and durable rollback queues, uninstall, recovery codes/TOTP reset, certificate renewal, API-configurable limits/cache, container telemetry, weekly base-image refresh, and slow-deploy tracing are implemented and locally tested.

Updates wait for active deployments, helper confirmation, the new version, and readiness; the panel updates last. Tests cover official Minisign interoperability; altered signatures/hashes and downgrade rejection; executable replacement/rollback; active WAL backup; online restore rejection; wrong keys, corruption, truncation, and traversal rejection; fresh backups after restore; atomic one-use recovery; real mTLS renewal; and Docker/BuildKit metrics/prewarming.

## Design boundaries

Dockerfiles are mandatory in the initial version. No AI or automatic stack detection was added. The agent protocol has no remote shell/exec. Git uses fixed arguments without token argv or external hooks/config. Build secrets use BuildKit providers; runtime environment values never become build ARGs.

Runtime containers use non-root UID/GID, cap-drop ALL, no-new-privileges, read-only rootfs, bounded tmpfs, CPU/RAM/PID limits, per-app bridges, and no published ports. mTLS and message signatures are complementary; replay journals survive restarts. Desired state and swap intent are encrypted. Webhooks/queue mutations are transactional. Slow GitHub operations remain in the outbox. Services own authorization, and UI environment edits never need existing secret values.

The updater preserves the database and rolls back executables, so releases must maintain schema/protocol compatibility for that rollback. Docker, BuildKit, and Caddy have separate update lifecycles. Uninstall preserves shared services and application containers for explicit migration.

## Security review boundaries

- Validate installers on disposable infrastructure before using machines with data. They modify firewall, SSH, Docker, systemd, and keys. Tested SSH access remains an operator responsibility.
- Docker socket control gives the agent daemon-level host authority. Container/protocol restrictions do not isolate a fully compromised host.
- Keep release/CA/master keys and first-access files private. Losing the master key prevents recovery of encrypted settings/environment/TOTP. Backup encryption uses an independent key that must remain outside both host and bucket.
- Audit is append-only through SQLite rules, not against root editing the file. Scopes are installation-wide; there is no per-app/team ACL. users:write is highly privileged.
- Validate five-second drain with long requests, streaming, crashes, and route-commit failures before claiming zero downtime. Local short-request tests do not cover all production traffic.
- Browser logs are ephemeral; transport saturation can drop logs. Compressed archives are not guaranteed lossless delivery records.
- Diagnostics are private-interface only; profiles are private operational data. No artificial PGO profile was produced.

## Final bug and security review

| Problem | Fix and local regression coverage |
| --- | --- |
| Private reads/locks accepted special files or unsafe paths | Descriptor validation, O_NOFOLLOW/O_NONBLOCK, regular-file/size/permission checks, one-link locks; regressions reproduce the original acceptance |
| Concurrent certificate replacement could desynchronize disk/memory | Serialized persistence and reload, bounded private certificate reads |
| Restore could escape changed paths or accept future/invalid state | os.Root confinement, no-overwrite creation, schema/reference/encrypted-certificate validation, aligned archive/file limits |
| Root restore created service-inaccessible directories | New directories inherit destination UID/GID; reproduced and tested as root in Debian containers |
| Update reread mutable version requests or retained new binaries after persistence failure | Bind callbacks to validated versions, reject unreadable state, restore executable/version on sync/persistence failure, root-configured loopback health URL |
| Authentication challenge/counter/factor/session writes were separate | One transaction plus savepoint; failed attempts consume challenges while rolling back partial writes; tests cover counters, resets, and session-creation errors |
| TOTP activation preserved prior access; SSE retained revoked credentials | Revoke sessions/tokens/challenges on activation and revalidate streams at heartbeat |
| Enrollment allowed key reuse or unsupported cache limits | Reject panel/other-agent WireGuard keys and align initial minimum cache to 64 MiB |

Final recorded checks included build/unit/lint/generation, race, real integration, Minisign interoperability, Debian/Ubuntu syntax, API backup→online-restore rejection→offline restore→new backup, root container maintenance/updater tests, and arm64 cross-builds. No VPS or root workstation installation was performed. External acceptance remains open.
