# Architecture decision records

Each file records one decision: its context, the options, the choice, and the consequences. Copy [the template](template.md), take the next number, and link the new record here.

Statuses: **Proposed** (awaiting maintainer approval), **Accepted**, **Superseded by ADR-NNNN**, **Rejected**. A record is never rewritten after acceptance; a new record supersedes it.

Earlier decisions are recorded in the running log [decisions.md](../../decisions.md). They remain valid; new decisions go here ([ADR-0001](0001-record-architecture-decisions.md)).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs | Proposed |
| [0002](0002-modular-monolith-with-boundary-ports.md) | Keep a modular monolith; use ports only at external boundaries | Proposed |
| [0003](0003-agent-jobs-outlive-control-sessions.md) | Agent jobs outlive control sessions | Proposed |
| [0004](0004-supervised-background-loops.md) | Supervise background loops instead of stopping the process | Proposed |
| [0005](0005-durable-notification-outbox.md) | Deliver notifications from a durable outbox | Proposed |
| [0006](0006-fresh-authentication-for-sensitive-writes.md) | Require fresh interactive authentication for sensitive writes | Proposed, needs a choice |
| [0007](0007-enforce-package-dependency-rules.md) | Enforce package dependency rules with a test | Proposed |
