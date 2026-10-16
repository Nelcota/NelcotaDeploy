# Backend changes made for the frontend

The web interface consumes `internal/service` without adding business rules to handlers. Where the contract lacked something the interface needed, the smallest service or wiring change was made and tested. Each entry lists what changed, why, and where.

## Passkey and factor management

- **What:** `Auth.Factors(ctx) (Factors, error)` lists the signed-in user's own passkeys (ID, last use), whether TOTP is configured, and how many recovery codes remain unused. `Auth.RemovePasskey(ctx, id) error` deletes one of the user's own passkeys.
- **Why:** The contract could register passkeys but not list or remove them, and exposed no TOTP state, so an account page could not show or manage sign-in factors.
- **Rules:** Bearer tokens are rejected for both. Removal requires a recent interactive session (the existing `freshInteractive` five-minute rule), only touches the caller's `passkey` rows, refuses to delete the last passkey (`Conflict`), and is audited as `auth.passkey.remove` in the same transaction. No key material is returned.
- **Where:** `internal/service/factors.go`, interface additions in `internal/service/auth.go`. Tests: `internal/service/factors_test.go` (ownership, TOTP rows cannot be removed as passkeys, stale-session rejection, last-passkey protection, audit row, bearer rejection).

## Web extension point configuration

- **What:** `web.Register(r, web.Config{...})` replaces `web.Register(r, services)`. The config carries the services plus the panel origin, development flags, the build version, a function returning the CSRF token for the request's session cookie, and the existing stream revalidation check. `httpapi.Config` gained `Version`.
- **Why:** Server-rendered pages must embed the CSRF token that `internal/httpapi` derives from the HttpOnly session cookie, and long-lived page streams must re-check credentials the same way `/api/events` does. Exposing two functions keeps the cookie name, CSRF key, and session logic inside `internal/httpapi`.
- **Where:** `internal/httpapi/router.go` (`requestCSRF`, the `web.Register` call), `cmd/nelcota-panel/main.go` (passes `updater.Version`), `web/routes.go`.

## Development origin override

- **What:** `nelcota-panel dev` reads optional `NELCOTA_DEV_ORIGIN` and `NELCOTA_DEV_LISTEN`. Defaults are unchanged (`http://127.0.0.1:8080`).
- **Why:** Browsers reject IP addresses as WebAuthn relying-party IDs, so passkeys cannot be exercised against `127.0.0.1`. With `NELCOTA_DEV_ORIGIN=http://localhost:18080` and `NELCOTA_DEV_LISTEN=127.0.0.1:18080`, real browser ceremonies (and Playwright's virtual authenticator) work. The listener must still be a loopback IP; the existing check is unchanged.
- **Where:** `cmd/nelcota-panel/main.go` (`devConfig`).

## Development metrics simulation

- **What:** `nelcota-panel dev` now publishes host metrics that vary smoothly over a three-minute cycle (CPU, memory, disk, network counters) and one container sample per app, in the same JSON shape as `agentv1.Metrics`.
- **Why:** The previous constant sample (12% CPU, fixed memory) made live cards and uPlot charts impossible to verify during development, and container entries were never exercised. Production metrics are unchanged.
- **Where:** `internal/service/dev.go` (`devMetrics`).

## English error message

- **What:** The API's trailing-JSON validation message changed from Portuguese ("JSON adicional") to "Unexpected additional JSON".
- **Why:** Repository rules require English for all UI and API text. The status code and `validation` code are unchanged.
- **Where:** `internal/httpapi/router.go` (`read`).

## Failure reasons from the agent

- **What:** The agent fills the existing `DeployStatus.error_code` field when a deployment fails: `clone_failed`, `build_failed`, `start_failed`, `app_exited`, `health_no_response`, `health_status_<code>`, `route_failed`, `state_error`, `workspace_error`. The health check returns a typed `HealthError` with the last HTTP status, and the pipeline checks whether the container exited. The panel stores the reported code when it is a plain lowercase code (`^[a-z][a-z0-9_]{0,39}$`) and keeps `deployment_failed` otherwise.
- **Why:** The interface explains failures in plain language with a next step; a single generic code made that impossible.
- **Where:** `internal/agent/docker.go` (`HealthError`), `internal/agent/pipeline.go` (`code`, `healthCode`), `internal/service/deploys.go` (`failureCode`). Tests: `internal/agent/pipeline_test.go` (`TestFailureCodesNameTheStep`), `internal/service/dev_test.go` (`TestFailureCode`, `TestAgentFailureCodeIsStored`).

## Build cache usage

- **What:** `Metrics.cache_used` (field 9) reports BuildKit's cache size, summed from `DiskUsage` and refreshed at most once a minute. Generated code was regenerated with protoc 36.1 (the CI version); regenerating before the change produced no diff.
- **Why:** Servers showed only the cache limit, so "Free up space" could not say how much space the cache took.
- **Where:** `proto/agent/v1/agent.proto`, `internal/gen/agent/v1/*`, `internal/agent/metrics.go` (`buildCacheUsed`, `cacheTotal`). Tests: `TestCacheTotal`; the real-BuildKit integration test now asserts a nonzero value (not run on this workstation because the Docker daemon was stopped).

## Team management

- **What:** `Users.SetRole(ctx, id, role)` and `Users.Remove(ctx, id)`, with `PUT /api/users/{id}/role` and `DELETE /api/users/{id}`. Admin with `users:write`; people can't change or remove themselves; the last administrator can't be demoted or removed; a role change revokes the person's API tokens; removal deletes passkeys, sessions, tokens, recovery codes, and pending challenges (audit rows keep the ID). Both are audited.
- **Why:** There was no way to remove someone or change a role.
- **Where:** `internal/service/users.go`, `internal/service/auth.go` (interface), `internal/httpapi/router.go`. Test: `internal/service/users_test.go`.

## Repository inspection

- **What:** Optional `Services.Repos` with `Inspect(ctx, RepoQuery) RepoInfo`: default branch, branch list, branch head (SHA, first line of the message, author), whether the Dockerfile exists, and the first `EXPOSE` port. `GitHubService` implements it through the GitHub API, with the App installation for private repositories or anonymously for public ones; `GitHubService.APIBase` overrides the API URL in tests. `DevRepos` returns stable simulated data in development mode. Errors map to plain messages (not found, refused, rate limit).
- **Why:** The new-app wizard fills in branch and port, and "Publish latest" publishes the branch head instead of rebuilding the last deployed commit.
- **Where:** `internal/service/repos.go`, `internal/service/github.go`, `internal/service/types.go`, `cmd/nelcota-panel/main.go`. Tests: `internal/service/repos_test.go` (fake GitHub API, validation, authentication, Dockerfile parsing, stable dev data).

## DNS check

- **What:** `Apps.CheckDomains(ctx, id) []DomainCheck` resolves each domain with a three-second timeout and reports its addresses. The panel doesn't know servers' public IPs, so it reports where a domain points rather than whether it is correct.
- **Why:** People need to confirm DNS records before a certificate can be issued.
- **Where:** `internal/service/domains.go`, `internal/service/types.go`. Test: `internal/service/domains_test.go`.

## Development simulation

- **What:** The development agent now walks deployments through all five stages with stage timings and realistic log lines, fails commits whose SHA starts with `dead` at the health check with `health_no_response`, and reports a cache size.
- **Why:** The step display, failure explanations, and cache meter must be visible and testable without infrastructure.
- **Where:** `internal/service/dev.go` (`simulate`, `devStages`). Test: `TestDevSimulationStagesAndFailure`.

## Profile photos

- **What:** Migration `00009_avatars.sql` adds `avatars(user_id, image, updated_at)` with `ON DELETE CASCADE`, so removing a person removes their photo. `Auth.SetAvatar(ctx, upload)`, `Auth.RemoveAvatar(ctx)`, and `Auth.Avatar(ctx, userID)`: people change only their own photo, from an interactive session (API tokens are refused); any signed-in person can view teammates' photos. Uploads up to 900 KiB are decoded (JPEG, PNG, GIF, WebP), checked for 32 to 6000 pixels per side before full decoding, cropped to the centered square, scaled to 256 px, and re-encoded as JPEG, which drops metadata and anything else embedded in the file. Changes are audited (`user.avatar.set`, `user.avatar.remove`). `Principal.avatar_at` (from the session and the user list) versions the photo address for caching. New dependency: `golang.org/x/image` (scaling and WebP decoding).
- **Why:** People asked for profile photos.
- **Where:** `internal/service/avatars.go`, `internal/service/auth.go`, `internal/service/types.go`, `internal/store/queries/domain.sql` (`ListUsers`), regenerated `internal/store/dbgen`. Tests: `internal/service/avatars_test.go` (lifecycle, caching version, cascade, audit; SVG, text, truncated, tiny, oversized, and huge-dimension uploads; API tokens).

## Automation (October 16, 2026)

Each item lists what changed and where; tests are named next to it.

- **GitHub App installation, found automatically.** `Repos.Inspect` asks GitHub which installation covers the repository (`GET /repos/{owner}/{repo}/installation` with the App's JWT) when no ID is given, and returns it in `RepoInfo.InstallationID`. Push webhooks, which GitHub signs, fill `installation_id` for apps that have none (never replacing one a person set). `GitHubService` gained `appCredentials`, `findInstallation`, and `client` helpers. Tests: `TestInspectFindsInstallationAndReadsFiles`, `TestWebhookRemembersInstallation`.
- **Repository detection.** `RepoInfo.HealthPath` from a Dockerfile `HEALTHCHECK` that requests a local URL, and `RepoInfo.EnvKeys` from `.env.example` (names only, at most 100, files up to 256 KiB). Tests: `TestDockerfileHealthPathAndEnvExample`.
- **GitHub App creation returns to the panel.** `/api/github/callback` redirects browsers to the App installation page (JSON stays for `Accept: application/json`), and the manifest sets `setup_url` so GitHub brings people back to Settings › Connections. Test: `TestGitHubCallbackSendsBrowsersBackToSettings`.
- **Automatic retry of transient failures.** Migration `00011_deploy_retries.sql` adds `deployments.retry_of`. A deployment that fails with `route_failed` is queued once more with the same commit, unless it was a retry, was cancelled, the app is stopped, or a newer deployment exists. Build, start, and health check failures are never retried. Test: `TestTransientFailureIsRetriedOnce`.
- **Disk relief.** When a server reports 85% disk use or more, the panel sends the "remove unused images" cleanup, at most once an hour per server, audited as `server.prune.orphan_images.auto` (`internal/service/maintenance.go`). Test: `TestFullDiskRemovesUnusedImagesAtMostHourly`.
- **Update checks.** `updater.Trust.Latest` reads the unsigned `<release_url>/latest` pointer (64 bytes, no redirects, stable versions only). `OperationsService` checks every six hours, verifies the release signature before announcing it (`update.available`), and queues it when the `updates.automatic` setting is on. `Operations.Updates` and `SetAutomaticUpdates` (recent passkey sign-in required) serve the interface; `queueUpdate` is shared by people and the automatic path. Tests: `TestLatestIsBoundedAndValidated`, `TestUpdateCheckAnnouncesVerifiedReleasesAndQueuesWhenAutomatic`.
- **Notifications.** `Notifier` (`internal/service/notifier.go`) subscribes to the deployments, servers, and operations topics and sends: failed deployments (not ones being retried), servers going offline (hourly at most), disks at 90% after cleanup (every six hours at most), failed or unrestorable backups, stopped updates, and new versions. Delivery (`notify_delivery.go`) runs in the background with a bounded queue and three attempts with backoff:
  - Webhooks: Slack and Discord formats, recognized by host; generic JSON signed with `X-Nelcota-Signature` (HMAC-SHA256) when a secret is set. HTTPS only, no redirects, and a dialer that resolves names itself and refuses private, loopback, link-local (cloud metadata), and reserved addresses, so DNS rebinding can't reach the internal network. Discord mentions are disabled and Slack markup is escaped.
  - Email: SMTP on 465 (TLS) or 587/2525 (STARTTLS required; servers without it are refused before authenticating). Headers can't be injected; addresses are parsed with `net/mail`.
  - Configuration is one sealed setting (`notify.config`); `Notifications.Get` never returns the webhook address or SMTP password, and saving with empty secret fields keeps them. `Core.saveSetting` was extracted from `settingsService.Set` for this.
  - Tests: `internal/service/notify_test.go` (address rules, chat escaping, signatures, redirects, redaction, translation and cooldowns, background delivery, a fake SMTP server with STARTTLS).
- **Invitation email.** With email configured, inviting someone also sends the enrollment link; the token is in the URL fragment (`/enroll#token=…`), which browsers never send to servers. The token stays on screen as a fallback.
- **Weekly backup verification.** `maintenance.Backup.Verify` and `VerifyLatest` test-restore the newest completed backup into a temporary directory with the same checks as a restore (authentication, completeness, master key, database integrity, schema, secrets), weekly. `stageArchive` was extracted from `Restore`, which now uses it. Failures are announced as `backup.unverified`. Test: `TestVerifyTestRestoresWithoutTouchingData` (restore tests unchanged and passing).
- **S3 connection test.** `maintenance.S3.Test` uploads and deletes a small object; `Settings.TestS3` runs it on the filled-in form before saving. `objectURL` and `do` were extracted from `Upload`. Test: `TestS3ConnectionTestUploadsThenDeletes`.
- **Install script and SSH provisioning.** `service.InstallScript` is now the only source of the join script; it fills the release URL and signing key from the panel's own release trust (`ReleaseFor`) and keeps placeholders for development builds. Every embedded value is validated to a safe character set. `Provisioner` (`Provisioning` interface) reads a server's SSH host key for people to confirm, then runs the script over SSH only if the host key matches exactly, as root or with `sudo -n`, with the invitation checked against that server, a recent passkey sign-in, a 20-minute limit, and the token masked in the live log. Private keys stay in memory for the job only. Test: `internal/service/provision_test.go` (in-process SSH server: success, changed host key, sudo, failing script, unknown invitation, option-like hosts).
