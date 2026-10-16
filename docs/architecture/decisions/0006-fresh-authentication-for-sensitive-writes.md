# ADR-0006: Require fresh interactive authentication for sensitive writes

- **Status:** Proposed, needs a maintainer choice between options 2 and 3
- **Date:** 2026-10-16
- **Findings:** F-05

## Context

`CreateToken` requires a fresh interactive login (`freshInteractive`, `internal/service/tokens.go:44-48`), and `SetAutomaticUpdates` does too (`internal/service/updates.go:505-517`). But:

- `settings.Set` accepts an admin token with `settings:write` and can change `github.private_key`, `github.webhook_secret`, `backup.s3`, and `updates.automatic` (`internal/service/core.go:498-519`), bypassing the check on `SetAutomaticUpdates`.
- Creating a user and changing a role accept an admin token with `users:write` (`internal/service/auth.go:581-586`, `internal/service/users.go:10-14`). A leaked token can create a new administrator whose access outlives the token's 30-day limit.

[Status](../../status.md) already describes `users:write` as highly privileged.

## Options

1. **Keep as is and document.** Automation can manage users and settings; a leaked token has durable impact.
2. **Interactive only.** `settings.Set` for secret-bearing keys and `updates.automatic`, user creation, and role changes require `freshInteractive`; the `settings:write` and `users:write` scopes remain for reads and low-risk writes, or are removed.
3. **Split scopes.** Keep token access but add explicit high-risk scopes (`settings:secrets`, `users:admin`) that can only be granted to tokens with a short maximum lifetime (for example 24 hours) and are recorded with a distinct audit action.

## Decision

Pending. The audit recommends **option 2**: it matches the existing rule that bearer tokens cannot mint broader access, and no documented automation needs these writes.

## Consequences

- Option 2 is a behavior change for API clients using these scopes; release notes must say so.
- Either option adds tests that a token request to each sensitive path is refused (option 2) or limited (option 3).
