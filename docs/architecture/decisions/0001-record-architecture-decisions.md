# ADR-0001: Record architecture decisions as ADRs

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-29

## Context

[decisions.md](../../decisions.md) is a single running log without dates, statuses, alternatives, or supersession. Stale entries (visual tests described as opt-in, build concurrency "two") cannot be marked as replaced, and interface changelog items sit next to architectural choices.

## Options

1. **Keep the single log.** No migration cost; staleness continues.
2. **ADRs for new decisions, keep the log as history.** Small cost; old entries stay where links point to them.
3. **Migrate the whole log into ADRs.** Clean history; large rewrite and many broken links.

## Decision

Option 2. New architectural decisions are written as numbered ADRs in `docs/architecture/decisions/`. `decisions.md` stays as the historical log; when an ADR replaces one of its entries, the entry gets a one-line pointer to the ADR. Interface copy and visual choices may stay in `decisions.md`.

## Consequences

- Reviewers can ask "which ADR covers this?" for structural changes.
- Stale log entries are corrected with pointers as part of roadmap stage S14.
