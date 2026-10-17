# Refactoring risk matrix

Probability and impact: **H**igh, **M**edium, **L**ow. Risks refer to [roadmap](roadmap.md) stages.

| ID | Risk | Stage | Probability | Impact | Mitigation | Detection |
| --- | --- | --- | :-: | :-: | --- | --- |
| R-01 | Buffered agent events arrive in a different order after reconnect, and the panel rejects valid transitions | S1 | M | H | Coalesce status per deployment and send the latest only; panel transition checks tolerate repeated states; heartbeat repair remains | Reconnect fault-injection test; integration route-swap test |
| R-02 | Event buffer grows without bound while the panel is unreachable | S1 | M | M | Fixed capacity; logs dropped first; status coalesced; documented limit | Unit test with a disconnected sink and 10,000 log lines |
| R-03 | API clients that use `settings:write` or `users:write` tokens break after the ADR-0006 change | S2 | L | M | Release notes; clear `Forbidden` message naming the reason; option 3 of ADR-0006 if needed | Token tests; release checklist |
| R-04 | Backup pruning removes the only valid archive | S3 | L | H | Never prune the newest verified archive; prune only after a successful local create | Retention test with failing uploads and verification |
| R-05 | New optimistic-concurrency conflicts confuse people editing settings | S4 | M | L | Conflict message with a reload action; revision sent by every form | Playwright settings test with concurrent edit |
| R-06 | Changing what the audit log records conflicts with append-only triggers or compliance expectations | S4 | M | M | ADR before the change; triggers unchanged; retention only through a documented, audited maintenance path, or none | Migration test; trigger test |
| R-07 | Large linter-driven diffs hide behavior changes | S5 | M | M | One linter per commit; mechanical fixes separate from behavior fixes; review discards case by case | Review; full test suite |
| R-08 | Package moves conflict with ongoing feature work and cause painful merges | S6 | H | M | Move-only commits, landed quickly, announced in the PR; one package per change | Merge conflicts in review |
| R-09 | Moving deployment policy into the service changes what the interface deploys | S7 | M | H | Keep existing web tests unchanged as the oracle; remove the old path only after the service path passes them | Web deploy tests; Playwright deploy dialog |
| R-10 | Notification outbox sends duplicates after a crash between send and mark | S7 | M | L | At-least-once by design; delivery key in webhook payload and email headers; document | Restart test |
| R-11 | sqlc generation changes `NULL` and integer types in subtle ways | S8 | M | M | Per-feature commits; characterization tests from S0; compare query results before and after | Service tests; `make check-generated` |
| R-12 | Refactoring the root update helper introduces a failure that leaves a host without a working binary | S9 | L | H | Characterization tests first; staging package flow from [staging releases](../staging-releases.md); VPS acceptance before release | Updater tests; VPS update and rollback stage |
| R-13 | Dependency upgrades (go-webauthn, go-sqlite3) change behavior that tests do not cover (real passkeys, WAL details) | S13 | M | H | One upgrade per change; read changelogs; Playwright virtual authenticator; backup and restore tests; VPS passkey check | Full suite; VPS acceptance |
| R-14 | Changing the command signature format breaks mixed-version fleets | S13 | M | H | Golden-command tests first; any format change is a new protocol version with dual verification during rollout | Cross-version test |
| R-15 | Refactoring time crowds out VPS acceptance, so local results are mistaken for production readiness | All | M | H | Keep "local is not VPS acceptance" in every stage's done criteria; status page lists pending acceptance | Status review at S15 |
| R-16 | Characterization tests freeze defects as expected behavior | S0 | M | M | Known defects become skipped tests naming the finding, never asserted wrong values | Review of S0 tests |
