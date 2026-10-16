# Refactoring backlog

Tasks in roadmap order. Each task is one reviewable change unless noted. Status values: **todo**, **in progress**, **done** (with commit), **accepted** (decided not to change, with ADR), **deferred** (with reason and date). Effort in engineer-days.

## S0. Baseline and safety net

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-001 Migration up/down/up test with golden schema in `internal/store` | F-28 | 0.5 | todo |
| T-002 `AgentEvent` characterization tests per event kind, ownership rejection, `observedState` repair | F-28 | 1 | todo |
| T-003 Cancel-vs-claim race test (skipped, names F-11) | F-11 | 0.5 | todo |
| T-004 `appsService.Action` and `Delete` tests | F-28 | 0.5 | todo |
| T-005 Agent reconnect-during-deploy and slow-reconcile tests with fakes (skipped, name F-01/F-02) | F-01, F-02 | 1 | todo |
| T-006 JSON API tests for apps, users, tokens, operations, settings | F-28 | 1 | todo |
| T-007 Store baseline artifacts in CI (coverage, gocognit top 25, benchmarks) | — | 0.5 | todo |

## S1. Agent session and job lifecycle

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-101 Log session end reasons in `AgentClient.Run` and `Broker.Connect` | F-04 | 0.5 | todo |
| T-102 Job contexts from `Pipeline.Run`; session-independent event sink with bounded buffer | F-01 | 2 | todo |
| T-103 Reconcile on its own goroutine; receive loop only verifies and enqueues | F-02 | 1.5 | todo |
| T-104 Report handler failures as events; only verification errors end a session | F-03 | 1 | todo |
| T-105 HTTP/2 read-idle ping on the agent transport | F-45 | 0.5 | todo |

## S2. Panel reliability and security

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-201 Decide ADR-0006, then apply it to `settings.Set`, user creation, `SetRole` | F-05 | 1 | todo (blocked on decision) |
| T-202 `internal/supervise` helper; run work loops under it | F-06 | 1 | todo |
| T-203 Scheduler: deadlines on `GitHub.Token` and `Control.Send`, log errors | F-13 | 0.5 | todo |
| T-204 Notifier resubscribes after hub drop, logs it | F-07 | 0.5 | todo |
| T-205 `web.Register` denies on nil `Authorized`; `provisionStream` re-checks credentials | F-31 | 0.5 | todo |
| T-206 pprof and flight recorder on loopback by default | F-32 | 0.5 | todo |
| T-207 Log untyped web errors; do not log `context.Canceled` as failure | F-24 | 0.5 | todo |

## S3. Backup operations

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-301 Separate local creation from upload; prune and verify regardless of upload; report upload failures | F-08 | 1 | todo |
| T-302 Manual snapshot retention or removal action; update operations doc | F-08 | 0.5 | todo |
| T-303 Separate create and upload timeouts; size-aware upload timeout; evaluate multipart | F-10 | 1 | todo |
| T-304 Backup key fingerprint in System settings; warn on co-located key | F-09 | 1 | todo |

## S4. Consistency and audit

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-401 Transactional `Cancel`; scheduler skips `cancel_requested`; status-guarded updates | F-11 | 1 | todo |
| T-402 Revision check in `save`, `Action`, installation update; forms send revision | F-12 | 1.5 | todo |
| T-403 ADR on audit scope and retention | F-14 | 0.5 | todo |
| T-404 Audit records real `/ui` outcome; skip unauthenticated rejected requests (per ADR) | F-14 | 1.5 | todo |
| T-405 WireGuard and key generation outside the writer transaction in `Join`, with compensation | F-39 | 1 | todo |

## S5. Static analysis

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-501 Enable `staticcheck`; fix findings; replace deprecated Moby constructor | F-25, F-38 | 0.5 | todo |
| T-502 Enable `errcheck` with documented exclusions; fix findings | F-25 | 1–2 | todo |
| T-503 Enable `errorlint`, `bodyclose`, `contextcheck` | F-25 | 0.5–1 | todo |
| T-504 Enable reviewed `gosec` rules | F-25 | 0.5–1 | todo |
| T-505 `gocognit` threshold 30 for new code; existing functions listed | F-25 | 0.5 | todo |

## S6. Boundaries and composition

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-601 Dependency rule test with today's allowlist | F-17, F-19 | 1 | todo |
| T-602 `cmd/nelcota-panel/config.go`: one validated configuration; bound agent `BuildLimit` | F-44 | 1 | todo |
| T-603 `service.New(Deps)` and `service/ports.go`; remove nil-as-flag | F-16 | 2 | todo |
| T-604 Move webhook and mail delivery to `internal/integration/*` | F-17 | 1 | todo |
| T-605 Move SSH install and WireGuard to `internal/integration/*` | F-17 | 1 | todo |
| T-606 Move GitHub client code to `internal/integration/github`; service-owned peer type instead of `transport.Peer` | F-17 | 1.5 | todo |
| T-607 Command signing to `transport/command.go`; `security` without proto imports | F-19 | 0.5 | todo |
| T-608 Split `host` into `fsx`, `serve`, `diag`, `hostmetrics`; untangle `transport → updater` | F-19 | 1.5 | todo |
| T-609 Move Docker, BuildKit, Caddy code to `internal/agent/runtime` | F-19 | 1 | todo |

## S7. Business rules into the service

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-701 `Deploys.EnqueueRef`; web and JSON API use it | F-15 | 1.5 | todo |
| T-702 `Apps.CreateAndPublish` | F-15 | 1 | todo |
| T-703 `deployment_state.go`; replace status literals | F-34 | 1 | todo |
| T-704 `Reauthentication` error kind; one status mapping | F-33 | 0.5 | todo |
| T-705 Notification outbox table and worker (ADR-0005) | F-07 | 2 | todo |

## S8. SQL consolidation

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-801 Raw SQL to sqlc: apps and settings | F-18 | 1–2 | todo |
| T-802 Raw SQL to sqlc: deployments, scheduler, agent events | F-18 | 1–2 | todo |
| T-803 Raw SQL to sqlc: auth, users, tokens, recovery | F-18 | 1–2 | todo |
| T-804 Raw SQL to sqlc: notifications, operations, enrollment | F-18 | 1–2 | todo |

## S9. Decompose complex code and close crash windows

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-901 Split `AgentEvent` per event kind | complexity | 1 | todo |
| T-902 Split `OperationsService.step` and `AgentClient.runOnce` | complexity | 1.5 | todo |
| T-903 Split `Pipeline.reconcile` and `deploy`; save state before routing | F-21 | 1.5 | todo |
| T-904 Startup sweep of unowned containers and build directories by label | F-21 | 1 | todo |
| T-905 Updater re-run completes or rolls back an unconfirmed install; split `Trust.Apply` | F-22 | 1.5 | todo |

## S10. Cleanup

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-1001 Remove `.goreleaser.yaml`, agent `rings` map, unused SSE modes; decide on redirect stubs | F-37 | 0.5 | todo |
| T-1002 Ignore `*.test` binaries | F-43 | 0.1 | todo |
| T-1003 Sanitize `TestS3` errors | F-35 | 0.25 | todo |
| T-1004 Webhook route body limit 25 MB | F-36 | 0.25 | todo |
| T-1005 Extract duplicated helpers | F-46 | 0.5 | todo |

## S11–S15

| Task | Finding | Effort | Status |
| --- | --- | ---: | --- |
| T-1101 One `slog` handler per binary, standard attributes, request IDs | — | 2 | todo |
| T-1201 Benchmarks for dashboard render and snapshot construction; `EXPLAIN` the queue query | F-23, F-40, F-41 | 1 | todo |
| T-1202 Fixes justified by T-1201 numbers | F-23, F-40, F-41 | 1–3 | todo |
| T-1301 Pin Caddy and test images in CI; race job with integration tag; Dependabot Docker | F-26 | 1 | todo |
| T-1302 SBOM and build-provenance attestation in release | F-27 | 1 | todo |
| T-1303 Golden cross-version signed-command test; signing ADR | F-20 | 1 | todo |
| T-1304 Dependency upgrades, one per change | F-42 | 2–3 | todo |
| T-1401 Fix stale statements; ADR pointers in `decisions.md`; threat model; host-loss runbook | F-29 | 1–2 | todo |
| T-1501 Final baseline comparison, findings re-audit, VPS acceptance of affected stages | — | 1–2 | todo |
