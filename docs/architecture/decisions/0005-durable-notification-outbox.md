# ADR-0005: Deliver notifications from a durable outbox

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-07

## Context

The notifier subscribes to the in-process hub. When a subscriber's buffer is full, the hub closes and removes it (`internal/events/hub.go:33-39`); the notifier's forwarders then exit and never resubscribe (`internal/service/notifier.go:55-66`). Events published while the panel restarts are also lost. Check runs already use a SQLite outbox with retry and backoff (`internal/service/checks.go`).

## Options

1. **Resubscribe on close.** Small; still loses events during bursts and restarts.
2. **Outbox table written in the same transaction as the status change.** Durable and idempotent; one migration and one worker.
3. **Poll recent status changes.** No new table; needs a cursor and duplicates logic.

## Decision

Option 1 as an immediate fix (roadmap stage S2), then option 2 (stage S7). The hub remains for live views, where dropping and re-snapshotting is the documented behavior.

## Consequences

- Notifications survive restarts and bursts and are delivered at least once; a delivery key prevents duplicates at the sender.
- The outbox table needs a retention rule (delivered rows older than 30 days are removed).
- The check-run worker and the notification worker share the supervision helper from [ADR-0004](0004-supervised-background-loops.md).
