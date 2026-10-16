# Architecture and modernization plan

Audit of commit `5636a52`, October 16, 2026. The plan is **proposed**; refactoring starts only after maintainer approval.

| Section | Document |
| --- | --- |
| A. Executive summary | Below |
| B. Technical map | [Overview](overview.md) and [current state](current-state.md#b-technical-map) |
| C. Architectural diagnosis | [Current state](current-state.md#c-architectural-diagnosis) |
| D. Architecture comparison | [Target state](target-state.md#d-architecture-comparison) |
| E. Design patterns | [Target state](target-state.md#e-design-patterns) |
| F. Proposed organization | [Target state](target-state.md#f-proposed-organization) |
| G. Refactoring plan | [Roadmap](../refactoring/roadmap.md) and [backlog](../refactoring/backlog.md) |
| H. Risk matrix | [Risks](../refactoring/risks.md) |
| I. Test strategy | [Roadmap](../refactoring/roadmap.md#test-strategy) |
| J. Definition of Done | [Roadmap](../refactoring/roadmap.md#definition-of-done) |
| Decisions | [ADRs](decisions/README.md) |
| Conventions | [Engineering conventions](../engineering/conventions.md) |

## A. Executive summary

**Current state.** NelcotaDeploy is a well-tested modular monolith in two Go binaries (panel and agent) with a sound layering: delivery packages call `internal/service`, which owns authorization and business rules, which calls SQLite through sqlc. Build, vet, lint, all unit tests, the race detector, and govulncheck pass on a clean checkout. Security engineering is strong (signed and replay-protected commands, mTLS with pinning, hashed tokens, scoped encryption, hardened containers, authenticated backups).

**Main problems.**

1. **Agent lifecycle coupling (critical).** Deploy jobs are bound to the control connection, commands are handled inside the receive loop, and any handler error ends the session, so a reconnect or a slow reconcile fails every running deployment on that server (F-01 to F-04).
2. **Sensitive writes reachable by API tokens (high).** Settings secrets, automatic updates, user creation, and role changes accept admin tokens, while token creation requires fresh interactive authentication (F-05).
3. **Fragile background work (medium).** One loop error stops the panel; the notifier can go silent permanently; backups stop pruning and verifying when S3 fails (F-06 to F-10).
4. **Consistency gaps (medium).** A cancel can be lost to a concurrent claim; app saves overwrite each other (F-11, F-12).
5. **Blurred boundaries (medium).** `internal/service` holds infrastructure adapters; some deployment policy lives in web handlers; `security` and `host` are grab-bags (F-15 to F-19).

**Direction.** Keep the modular monolith and its layering, make the dependency rules enforceable, add ports only at external boundaries, separate agent job lifecycle from connections, supervise background loops, and move must-not-lose side effects to an outbox. No rewrite, no new runtime dependencies required, no microservices.

**Effort.** 47–82 engineer-days across 16 stages; stages S0–S4 (safety net and the critical, high, and most medium fixes) are 16–28 days and deliver most of the risk reduction.

**Decisions needed before work starts.**

1. Approve the plan and the proposed ADRs 0001–0005 and 0007.
2. Choose option 2 or 3 in [ADR-0006](decisions/0006-fresh-authentication-for-sensitive-writes.md) (token access to sensitive writes).
3. Confirm the stage order, in particular whether S1 (agent lifecycle) may start before S2.
