# ADR-0007: Enforce package dependency rules with a test

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-17, F-19

## Context

The intended direction (delivery → service → store and adapters) is written only in `AGENTS.md`. Nothing stops new edges such as `service → transport` or `security → gen`, which exist today.

## Options

1. **Review only.** No tooling; relies on attention.
2. **A Go test in `internal/policy`** that reads `go list -deps -json ./...` and checks a table of allowed edges.
3. **An external linter (depguard in golangci-lint).** Configuration in YAML; less expressive for layer rules.

## Decision

Option 2, matching the existing English policy test. The rule table lives in the test and mirrors [target state](../target-state.md#dependency-rules-enforced-by-e7). Existing violations are listed in an allowlist that each roadmap stage shrinks; an allowlist entry that is no longer needed fails the test, as with the English allowlist.

## Consequences

- Boundary erosion fails `make test` with the offending edge named.
- Moving a package requires updating the table in the same change, which makes boundary changes explicit in review.
