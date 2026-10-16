# Current state: audit findings

Audit of commit `5636a52` on branch `feature/guided-panel-and-automation`, October 16, 2026. Every finding cites the code. **Verified** means the claim was confirmed by reading the cited lines during the audit; **hypothesis** means it is inferred and still needs a test or measurement. Nothing here has been reproduced on a VPS.

## Scope and method

- All tracked Go, templ, SQL, JavaScript, shell, workflow, and Markdown files were read in four batches: business core (`internal/service`, `store`, `events`, `provision`); agent side (`internal/agent`, `host`, `transport`, `security`, `updater`, both `cmd` packages, the proto); delivery (`internal/httpapi`, `web/**`); operations (`internal/maintenance`, `.github`, `scripts`, `Makefile`, docs).
- Generated code (`internal/gen`, `internal/store/dbgen`, `*_templ.go`, `web/static/dist`) was skimmed only. Vendored browser libraries were not reviewed.
- **Not analyzed:** ignored local directories (`.local/`, `dist/`, `bin/`, `.tools/`), GitHub repository settings (branch protection, environment reviewers, secret scanning), and behavior on real servers. Integration tests were not run in this audit, because the workstation run would not add evidence beyond CI and needs Docker and Caddy.

## Baseline (clean worktree at `5636a52`, Go 1.26.9, CGO disabled unless noted)

| Check | Result |
| --- | --- |
| `go build ./...`, `go vet ./...`, `go vet -tags=integration ./...`, `gofmt -l` | Pass, no output |
| `golangci-lint run` (current config) | 0 issues |
| `go test -count=1 ./...` | All 20 test packages pass |
| `go test -race ./...` (CGO enabled) | Pass |
| `govulncheck ./...` | 0 reachable; 1 required-module warning, GO-2026-5932 (`x/crypto/openpgp`, not imported, no fix) |
| `staticcheck ./...` (not part of CI) | 7 findings: deprecated Moby client constructor (`internal/agent/docker.go:54`), capitalized errors, numeric HTTP statuses |
| Coverage (statements) | service 66.6%, web 78.6%, maintenance 76.7%, security 73.9%, updater 59.1%, transport 58.2%, httpapi 44.0%, agent 40.9%, host 36.6%, cmd/nelcota-panel 19.0%, cmd/nelcota-agent and store 0% |

Largest functions by cyclomatic / cognitive complexity (gocyclo, gocognit):

| Function | Cyclomatic | Cognitive |
| --- | ---: | ---: |
| `service.(*Core).AgentEvent` (`internal/service/deploys.go:266`) | 53 | 99 |
| `transport.(*AgentClient).runOnce` (`internal/transport/connect.go:209`) | 36 | 75 |
| `service.(*OperationsService).step` (`internal/service/operations.go:209`) | 39 | 73 |
| `web.(*handler).deployApp` (`web/dashboard.go:230`) | 35 | 61 |
| `updater.(Trust).Apply` (`internal/updater/updater.go:241`) | 44 | 58 |
| `agent.(*Pipeline).reconcile` (`internal/agent/pipeline.go:432`) | 28 | 54 |
| `main.serve` (`cmd/nelcota-panel/main.go:290`) | 29 | 49 |

## B. Technical map

| Area | Facts |
| --- | --- |
| Language and runtime | Go 1.26.8 module, toolchain 1.26.9; Go 1.27.2 is the newest release and 1.26 is still supported ([go.dev/dl](https://go.dev/dl/), checked October 16, 2026) |
| Panel HTTP | chi v5, `x/time/rate`, templ v0.3.1020, Datastar 1.0.4, Tailwind, Basecoat, xterm.js 5.5.0, uPlot |
| Control protocol | ConnectRPC v1.19.1 bidirectional stream over HTTP/2, vtprotobuf codec, mTLS (TLS 1.3), Ed25519-signed commands |
| Persistence | SQLite via `ncruces/go-sqlite3` v0.30.2 (WASM, no CGO), goose v3.26.0, sqlc v1.30.0 |
| Identity | go-webauthn v0.14.0, pquerna/otp (TOTP), scoped API tokens |
| Agent runtime | BuildKit v0.34.0 client, Moby client v0.6.2, Caddy admin API |
| Integrations | go-github v75 with ghinstallation, wgctrl, x/crypto/ssh, net/smtp, hand-written SigV4 S3 |
| Build and release | Makefile, protoc 36.1, Minisign and keyless cosign signatures, SHA-pinned GitHub Actions, Dependabot |
| Direct dependencies behind latest | connect 1.21.1, go-webauthn 0.18.2, go-sqlite3 0.35.6, goose 3.29.0, templ 0.3.1070, VictoriaMetrics/metrics 1.44.1 (from `go list -m -u`, October 16, 2026; compatibility not yet assessed) |

Entry points: `nelcota-panel serve|dev|dev-seed|backup|backup-keygen|restore`, `nelcota-agent join|serve`, the root update helper (`internal/updater/commands.go`), and the installers `scripts/install.sh` and `scripts/agent.sh`.

## Strengths worth preserving

- Authorization lives in `internal/service` and is checked at the top of nearly every exported method (`require`, `authorize`, `freshInteractive`; `internal/service/types.go:57`, `tokens.go:26`, `recovery.go:182`).
- Writes are transactional with the audit row in the same transaction (`internal/service/core.go:97-115`); the deploy queue is backed by a partial unique index (`internal/store/migrations/00001_initial.sql:10`).
- Strong cryptographic hygiene: hashed tokens, AES-GCM with scoped associated data, constant-time TOTP with replay protection, SSRF-safe webhook dialer, authenticated backup frames with truncation protection, `os.Root` confinement in restore and updater.
- Hardened containers (UID 65532, read-only rootfs, cap-drop ALL, no-new-privileges, PID and memory limits).
- Disciplined CI and supply chain: pinned actions and tools, generated-code checks, race detector, integration tests with real services, asset budgets, goleak.
- Decisions and limitations are already written down ([decisions](../decisions.md), [status](../status.md)).

## C. Architectural diagnosis

Severity reflects impact on correctness, security, or operability for a self-hosted platform. Effort is in engineer-days (d) with explicit uncertainty.

### Critical and high

| ID | Severity | Finding | Evidence | Impact | Effort |
| --- | --- | --- | --- | --- | --- |
| F-01 | Critical | **Deploy jobs are bound to the control session.** `launch` derives the job context from the context passed to `Handle`, which is the stream errgroup context; the event sink is the session's `emit`. Any reconnect cancels every in-flight build and log follow on that server. Verified by reading; not reproduced. | `internal/agent/pipeline.go:264`, `internal/transport/connect.go:242,320` | Network blips or any F-02/F-03 teardown fail all running deployments | 3–5 d |
| F-02 | High | **Commands run synchronously in the receive loop.** Reconcile runs on every snapshot and can take up to 60 s per app; `Restart`, `Prune`, and `Stats` also block. Queued commands then exceed their 30 s lifetime, verification fails, and the session ends (triggering F-01). | `internal/agent/pipeline.go:150,180,220,472`, `internal/transport/connect.go:310-323`, `internal/security/crypto.go:94` | Self-inflicted reconnect loops under load or with an unhealthy app | 2–4 d (with F-01) |
| F-03 | High | **Any command error tears down the session.** `"build capacity exceeded"`, `"unknown app"`, `"invalid deploy"`, and state-save failures return from `Handle` and end the stream. Reconcile holds the per-app flag during health checks, so a deploy meant to fix an unhealthy app can be refused this way. | `internal/agent/pipeline.go:236,252,262,463-471`, `internal/transport/connect.go:320-322` | A single bad command cancels unrelated builds | 1–2 d |
| F-04 | High | **Session end reasons are never logged.** Signature, replay, clock-skew, and capacity failures look like silent reconnects. | `internal/transport/connect.go:188-207` | Field diagnosis of F-01..F-03 is impossible | 0.5 d |
| F-05 | High | **Admin API tokens reach writes that interactive users can only do after fresh re-authentication.** `settings.Set` accepts a `settings:write` token for GitHub private keys, webhook secret, S3 target, and `updates.automatic`, while `SetAutomaticUpdates` guards the same key with `freshInteractive`. `Create` user and `SetRole` accept `users:write`, while `CreateToken` requires `freshInteractive`. [Status](../status.md) already calls `users:write` highly privileged, so part of this is a known trade-off; the `updates.automatic` asymmetry is not. | `internal/service/core.go:498-519`, `updates.go:505-517`, `users.go:10-14`, `auth.go:581-586`, `tokens.go:44-48` | A leaked token can create a durable admin, or redirect backups to another bucket | 1 d plus a decision ([ADR-0006](decisions/0006-fresh-authentication-for-sensitive-writes.md)) |

### Medium

| ID | Finding | Evidence | Impact | Effort |
| --- | --- | --- | --- | --- |
| F-06 | One error from a background loop stops the whole panel: `RunChecks` returns database errors, the cleanup loop returns `auth.Cleanup` errors, certificate rotation returns errors, all inside one errgroup. | `internal/service/checks.go:29-31,50-52`, `cmd/nelcota-panel/main.go:439`, `internal/security/certificates.go:113-117` | A transient `SQLITE_BUSY` restarts the panel | 1 d |
| F-07 | The notifier can stop silently. The hub closes a full subscriber channel and deletes it; the notifier's forwarders exit and never resubscribe. Verified by reading; the trigger (256 queued events) is a hypothesis under bursts. | `internal/events/hub.go:33-39`, `internal/service/notifier.go:55-66` | Failure, offline, and disk alerts stop until restart | 1–3 d |
| F-08 | Backup pruning and verification depend on upload success: `.ok` and retention run only after `upload` succeeds, so a broken S3 target means no pruning and no weekly test restore. Manual backups (`manual-<id>.nbk`) are never pruned and no removal exists, contrary to [operations](../operations.md). | `internal/maintenance/backup.go:745-765`, `cmd/nelcota-panel/main.go:263` | Disk fills on the data volume; verified-backup gap | 1–2 d |
| F-09 | `backup.key` defaults to the same host directory as `master.key`; weekly verification uses the on-host key, so it never proves the operator's off-host copy. | `cmd/nelcota-panel/main.go:135,158` | Unrecoverable S3 backups after host loss | 1–2 d |
| F-10 | One 15-minute context covers create and upload; the HTTP client times out at 10 minutes; upload is a single PUT of up to 4 GiB. | `internal/maintenance/backup.go:738`, `internal/maintenance/s3.go:119` | Large databases on slow links never upload (worsens F-08) | 1 d |
| F-11 | Cancel race: status is read from the read pool, then `RequestCancel` runs unguarded; if the scheduler claims in between, the agent never receives a cancel and the scheduler never checks `cancel_requested`. | `internal/service/deploys.go:95-122,169-201` | "Cancelled" deployment runs to completion | 0.5–1 d |
| F-12 | Lost updates on app configuration: `save` and `Action` rewrite the whole config without the existing `revision` check; webhook `json_set` of `installation_id` can be overwritten by a stale save; the web form never sends the revision. | `internal/service/core.go:247,370-391`, `internal/service/github.go:365`, `web/appsettings.go:221-243`; optimistic locking exists in `internal/service/ports.go:528-533` | Concurrent edits silently overwrite each other | 1–2 d |
| F-13 | Scheduler swallows every error without logging and calls GitHub token minting and `Control.Send` without deadlines; one hung call stalls all dispatching. | `internal/service/deploys.go:158-209`, `internal/service/github.go:229-235` | Queue stops with no signal | 0.5–1 d |
| F-14 | Audit log grows without bound and records anonymous and CSRF-rejected non-GET requests; `/ui` actions are recorded as HTTP 200 even when they fail, because the SSE response commits 200 before the action runs. | `internal/service/core.go:678-686`, `internal/httpapi/router.go:401-414`, `web/sse.go:30` | Audit noise, false success records, unbounded table | 2–3 d plus a retention decision |
| F-15 | Deployment policy lives in a web handler: `deployApp` resolves typed vs picked SHA, short SHAs, branch head, and redeploy fallback; `createApp` chains create, environment, and enqueue without atomicity. The JSON API cannot do the same. | `web/dashboard.go:230-319`, `web/appsettings.go:148-181`, `internal/httpapi/apps.go:72-79` | Business rules outside `internal/service`; partial app creation on failure | 2–3 d |
| F-16 | `Core` is a god object with exported mutable fields assigned after construction; wrappers are built ad hoc (`&deploysService{c}`); `GitHub != nil` doubles as a feature flag. | `internal/service/core.go:33-52`, `cmd/nelcota-panel/main.go:312,344,393`, `internal/service/deploys.go:109,156,197,216,364`, `operations.go:369,378` | Hidden wiring order, nil-pointer risk, hard testing | 2–3 d |
| F-17 | `internal/service` talks directly to infrastructure: `transport.Peer`, protobuf command construction, `maintenance.S3`, wgctrl netlink, go-github, `net/smtp`, an HTTP delivery client, `x/crypto/ssh`. | `internal/service/deploys.go:252`, `enrollment.go:20-43`, `notify_delivery.go`, `provision.go`, `github.go` | 6,000-line package mixes rules with adapters; slow, wide tests | 4–6 d |
| F-18 | Around 106 raw `Exec/Query*Context` calls next to around 58 sqlc calls; raw SQL is not checked against the schema at generate time. | `grep` over `internal/service/*.go` | Schema changes break at runtime, not at build | 4–8 d (incremental) |
| F-19 | Grab-bag packages: `security` mixes primitives, wire-type signing, a replay journal, CA, rotation loop, and redaction, and imports generated proto types; `host` mixes private files, locks, HTTP serving, pprof, a global flight recorder, and host metrics returned as proto; `transport` imports `updater` for two plain JSON side endpoints. | `internal/security/crypto.go:18-19,70-141`, `internal/host/host.go:13-127`, `internal/host/flight.go:17`, `internal/transport/certificates.go:12,102-171` | Unclear ownership, wire format leaks into primitives | 2–3 d |
| F-20 | Hypothesis: command signatures cover a re-marshalled protobuf (`proto.MarshalOptions{Deterministic: true}`), which is not canonical across library versions; a panel/agent version skew could break verification. | `internal/security/crypto.go:70-82` | Fleet-wide command rejection after a dependency bump | 2–3 d |
| F-21 | Agent crash windows: containers started before the state save are orphaned (restart policy `unless-stopped`); leftover build directories are never swept; the reconcile replacement path routes before saving. | `internal/agent/pipeline.go:353,380,500-506`, `internal/agent/docker.go:210` | Orphan containers consuming memory after a crash | 1–2 d |
| F-22 | Hypothesis: if the root update helper crashes after the rename, the re-run is the new binary, `Newer` fails, the result is recorded as failed, and no rollback happens. | `internal/updater/updater.go:276,330-363` | Unverified binary left installed | 1–2 d |
| F-23 | N+1 queries: `shell()` always computes alerts through `appRows`, which lists deployments per app; actions that only render fragments pay for it; the dashboard stream re-renders everything on every app, deployment, server, or metrics event. Hypothesis on real cost; not measured. | `web/routes.go:155-160`, `web/dashboard.go:19-43,140-153,182-211` | CPU and SQLite reads scale with apps × open tabs × events | 2–3 d |
| F-24 | Untyped errors are never logged in web `act` and `failPage`; `context.Canceled` is logged as a failure in the JSON API. | `web/routes.go:203-232`, `internal/httpapi/router.go:316-341` | Lost diagnostics, log noise | 0.5 d |
| F-25 | The linter set is minimal (govet, ineffassign, unused); no errcheck, staticcheck, errorlint, bodyclose, gosec, contextcheck. | `.golangci.yml` | Unchecked `Close` on written files and error-wrapping mistakes pass CI | 1 d to enable, 2–4 d to fix findings (unknown count) |
| F-26 | Hypothesis: CI installs Caddy from Ubuntu apt for the native Caddy test, while runtime tests use the `caddy:2.10.2` image that [status](../status.md) cites. | `.github/workflows/ci.yml` (integration job), `internal/agent/caddy_integration_test.go:21` | Production and CI may test different Caddy versions | 0.5 d |
| F-27 | No SBOM and no build-provenance attestation; release-environment protection cannot be verified from the repository. | `.github/workflows/release.yml` | Weaker downstream verification | 1–2 d |
| F-28 | Test gaps on risky paths: `internal/store` (migrations up and down) has no tests; JSON handlers for apps, users, tokens, operations, settings are unexercised; `observedState` repair, Cancel race, reconnect during deploy, and helper re-run are untested; `cmd/nelcota-agent` has 0% coverage. | Coverage baseline above | Refactoring without a safety net | Covered by stage S0 |
| F-29 | No current architecture document and no ADR format; some statements are stale: visual tests described as opt-in while CI always runs them (`docs/decisions.md`, Interface), build concurrency "may choose two" while the schema allows 1–8, manual backups "until administrative removal" with no removal path. | `docs/decisions.md`, `docs/operations.md`, `internal/store/migrations/00001_initial.sql:4` | Docs mislead contributors | 1–2 d |

### Low

| ID | Finding | Evidence |
| --- | --- | --- |
| F-31 | `web.Register` defaults a nil `Authorized` callback to allow; `provisionStream` never re-checks credentials, unlike `live()`. | `web/routes.go:48-50`, `web/provision.go` |
| F-32 | pprof and the flight recorder are served without authentication over plain HTTP on the WireGuard address. | `internal/host/host.go:75-108` |
| F-33 | Error-to-status mapping exists twice and can drift (`unknown Kind` → 400 vs 503); re-authentication is detected by matching message text. | `internal/httpapi/router.go:316-341`, `web/routes.go:181-200,235-238` |
| F-34 | Deployment status and stage strings are repeated as literals across service, web, and agent. | `web/pages/explain.go:39`, `web/ui/format.go:50`, `internal/service/deploys.go:334` |
| F-35 | `TestS3` returns the provider's error text to the browser, against the contract rule. | `internal/service/core.go:532-536`, `docs/frontend-contract.md` |
| F-36 | GitHub webhook bodies are capped at the global 1 MiB; larger push payloads fail with an untyped 500. | `internal/httpapi/router.go:133` |
| F-37 | Dead or misleading code: unused `.goreleaser.yaml`; write-only agent `rings` map; unused SSE patch modes; redirect-stub pages. | `.goreleaser.yaml`, `internal/agent/pipeline.go:62,316`, `web/sse.go:59,61`, `web/settings.go:274-290` |
| F-38 | Deprecated Moby constructor and option (removal announced for the next release). | `internal/agent/docker.go:54` |
| F-39 | Long work inside the single writer transaction (WireGuard peer change and key generation in `Join`, certificate issue in `Renew`); the peer change is not undone on rollback. | `internal/service/enrollment.go:75-89`, `internal/service/certificates.go:24` |
| F-40 | Hypothesis: the queue query filters `status='queued'` every 500 ms but the only index leads with `app_id`; no index on `deployments(retry_of)`. Needs `EXPLAIN QUERY PLAN`. | `internal/store/queries/deployments.sql`, migrations |
| F-41 | `maskApp` decrypts all variables and rebuilds the redactor per log line; agents receive a full decrypted snapshot every ~10 s. | `internal/service/deploys.go:438-490`, `internal/transport/connect.go:301` |
| F-42 | Direct dependencies behind latest (see technical map); Go 1.27 available. | `go.mod` |
| F-43 | A 26 MB untracked `service.test` binary sits in the repository root and is not ignored. | `git status` |
| F-44 | Configuration is split between flags and environment-only values; `BuildLimit` from `join.json` is cast without bounds. | `cmd/nelcota-panel/main.go:135,259`, `cmd/nelcota-agent/main.go:107` |
| F-45 | Hypothesis: the agent's HTTP/2 transport has no ping or read-idle timeout, so a silent panel path is detected only by TCP retransmission. | `internal/transport/connect.go:212` |
| F-46 | Duplicated code: PEM-to-fingerprint (`enrollment.go:79-84`, `certificates.go:27-32`), challenge insertion (`auth.go:263,304`, `github.go:397`), owner/name parsing (`github.go:256-263`, `repos.go:123-131`), server limit parsing (`web/servers.go:43-50,84-91`). | Cited lines |

(F-30 was merged into F-28.)

## Architecture as it really is

- **Style:** a modular monolith per binary with an implicit three-layer shape: delivery (`httpapi`, `web`, `transport`) → application and domain (`service`, `agent`) → infrastructure (`store`, `maintenance`, `updater`, integrations inside `service`).
- **Real boundary:** `internal/service` is the only package that enforces authorization, and delivery packages do respect it; templates only use service types, never call methods.
- **Blurred boundaries:** infrastructure adapters live inside `service` (F-17); some policy lives in `web` (F-15); wire types leak into `security` and `host` (F-19); runtime lifecycles are coupled where they should be independent (F-01, F-06).
- **Folder names vs boundaries:** `internal/host` and `internal/security` are named as layers but act as shared toolboxes; `internal/provision` is only DTOs.
