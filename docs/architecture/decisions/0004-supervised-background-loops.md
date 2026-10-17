# ADR-0004: Supervise background loops instead of stopping the process

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-06, F-13

## Context

The panel runs about ten long-running loops in one `errgroup` (`cmd/nelcota-panel/main.go`). Several return transient errors (`internal/service/checks.go:29-31`, the session cleanup at `main.go:439`, certificate rotation at `internal/security/certificates.go:113-117`), which cancels the group and stops the panel. The scheduler does the opposite: it swallows every error without logging (`internal/service/deploys.go:170-179`).

## Options

1. **Fix each loop individually.** Repeats retry and logging logic in each loop.
2. **A small `supervise` helper.** Each loop runs under `Supervise(ctx, name, loop)`: errors are logged with the loop name and retried with capped exponential backoff; a panic is recovered, logged, and retried.
3. **A process supervisor library.** More features than needed.

## Decision

Option 2. Listener failures and startup errors still stop the process (systemd restarts it); long-running work loops never do. Every external call made from a loop has a deadline.

## Consequences

- Transient database or network errors no longer restart the panel.
- Loop errors become visible in logs with a stable `loop` attribute.
- Tests inject errors and panics into a loop and assert the panel keeps serving.
