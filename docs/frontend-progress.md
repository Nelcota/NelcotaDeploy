# Frontend progress

Working memory for the panel interface. Update this file at the end of each milestone. When a session resumes, read it first and continue from the first unchecked milestone.

Repository rules require English filenames, so the documents requested as `progresso-frontend.md`, `mudancas-backend.md`, `decisoes.md`, and `relatorio-frontend.md` live at `frontend-progress.md`, `backend-changes.md`, `decisions.md` (existing, new "Frontend" section), and `frontend-report.md`.

## Milestones

- [x] 1. Foundation: build pipeline, layout, themes, component library
- [x] 2. Authentication: first access, login, passkeys, TOTP
- [x] 3. Dashboard: apps, live server metrics, quick deploy
- [x] 4. App › Deployments: history, actions, live status
- [x] 5. App › Logs: build and runtime logs with xterm.js
- [x] 6. App › Settings: repository, domains, environment, health, resources
- [x] 7. Servers: status, uPlot metrics, disk/cache, invitations, prune
- [x] 8. Settings: users, passkeys, GitHub App, notifications, backup, audit, updates
- [x] 9. Command palette (⌘K)
- [x] 10. Polish: accessibility, SSE disconnection, visual review

## Environment notes

- Go 1.26.9 is not on the workstation PATH; it was installed to `~/sdk/go1.26.9` from the official archive (SHA-256 verified). Use `PATH=~/sdk/go1.26.9/bin:$PATH`.
- Node 26 and npm are available for vendoring and Playwright only; the Go build does not need Node.

## Log

### Milestone 1 — Foundation (October 16, 2026)

- Pipeline: `make web` runs `templ generate`, the pinned Tailwind v4.3.3 standalone CLI (checksum-verified by `scripts/install-tailwind.sh`), and `web/internal/assetgen`, which writes content-hashed files with Brotli and zstd variants into `web/static/dist`. `make tools` installs templ v0.3.1020 and Tailwind; `make check-generated` now also verifies `web/`. Vendored libraries are refreshed with `make web-vendor` (Node only; pinned in `web/package-lock.json`, Datastar pinned by SHA-256).
- Serving: `web/static` embeds `dist`, negotiates br → zstd → identity, and sets `Cache-Control: public, max-age=31536000, immutable`, `Vary`, and an ETag.
- Pages get a per-request CSP nonce; Datastar 1.0.4 runs in its nonce mode (`<html data-nonce>`), so no `unsafe-eval`.
- Layout: sidebar (drawer below `lg`), top bar with command palette trigger and theme selector (System/Light/Dark, stored per browser), development banner, skip link, toaster, re-authentication dialog.
- Components (`web/ui`): buttons, link buttons, status pills (text + tone), badges, fields with hint/error, cards, scrollable tables, empty/loading/error/notice states, toasts, confirmation and general dialogs, meters, copy buttons, Lucide icons.
- Backend changes so far: see `docs/backend-changes.md`.
- Checks: `go test ./web/... ./internal/httpapi ./internal/service` pass; gofmt, vet, ShellCheck clean. golangci-lint reported only `unused` helpers that milestones 2–3 consume (resolved there).

### Milestone 2 — Authentication

- `/login`: email + passkey (`navigator.credentials.get`), then TOTP or a recovery code when required; `next` is restricted to same-origin paths; fixed notice codes only. Development sign-in button appears only when `/api/dev/session` exists.
- `/enroll`: first-access or invitation token → passkey registration (`navigator.credentials.create`), with JSON fallbacks when `parse*OptionsFromJSON`/`toJSON` are missing.
- `/settings` (Account): profile, passkeys (list, add, remove with confirmation; last one protected by the service), two-factor setup (server-rendered QR from `BeginTOTP`, setup key, confirmation), recovery codes (shown once, copy/download), turn off two-factor, API tokens (list, create with scopes, shown once, revoke).
- Recent-authentication errors open a "Confirm it's you" dialog that runs a passkey (+TOTP) ceremony and reloads (new cookie ⇒ new CSRF token).
- Fixed: service `Unauthenticated` errors from ceremonies (expired challenge, wrong code) were treated as a lost session; they are now shown as messages.
- Tests: Go handler tests (`web/auth_test.go`) and Playwright `e2e/auth.spec.js` with a CDP virtual authenticator: add passkey → sign out → passkey sign-in → enable TOTP → sign in with TOTP → recovery codes → recovery sign-in. The flow exceeds the backend's `/api/auth` rate limit (burst 8); the test switches `X-Forwarded-For` (trusted from loopback) between phases instead of sleeping.

### Milestone 3 — Dashboard

- `/`: summary tiles, server cards (status, CPU, memory/disk meters, heartbeat), apps table (status, newest deployment SHA/message/author/time, server) with quick **Deploy** (rebuilds the newest deployed SHA; the panel cannot resolve branch heads).
- `/ui/stream/dashboard`: shared `live` loop subscribes to `servers`, `deployments`, `apps`; sends a full snapshot on every connection, patches server cards on `server.metrics`, re-renders on state events, revalidates credentials every 15 s, and ends when the hub drops a slow consumer so Datastar reconnects and reloads the snapshot. Connection state shows Live / Reconnecting / Disconnected.
- `/apps`: list page.
- Fixed a mobile overflow: `sr-only` table headers escaped the scroll container; table wrappers are now `relative min-w-0`.
- Backend: dev metrics now vary and include containers (`docs/backend-changes.md`).
- Tests: `web/dashboard_test.go` (page, member view, quick deploy incl. explicit SHA/clean/validation, live stream snapshot/metrics/deploy/revocation, unauthenticated stream) and `e2e/dashboard.spec.js` (live status to success; 360 px without horizontal scroll; mobile menu). Lint clean apart from helpers used by milestone 4.

### Milestone 4 — App › Deployments

- App header (breadcrumb, repository, branch, server, domains) and tabs shared by Deployments, Logs, and Settings.
- `/apps/{id}/deployments`: history with status, running version, cancellation in progress, error code, short SHA (full in title), origin and clean badges, message, author, queued time, total duration, and each stage duration (clone/build/start/healthcheck/route) — no invented progress.
- Actions: **Deploy now** (newest SHA), **Deploy a commit** (dialog: full SHA, description, clean build), **Clean build** (confirmation), **Cancel** for active deployments (confirmation), **Roll back** for earlier successful deployments (confirmation explains that it rebuilds).
- `/ui/stream/apps/{id}/deployments`: re-renders on this app's `deployments` events; while a deployment is active it also refreshes every 2 s because stage timings are persisted but only published on `deploy/{id}`.
- Dialogs carry `data-ignore-morph` so live re-renders never close an open confirmation.
- Tests: `web/deployments_test.go` and `e2e/deployments.spec.js` (deploy a commit → live success → roll back with confirmation → live success; cancel with confirmation). `templ fmt` v0.3.1020 fails internally on these files, so formatting is not enforced for `.templ` sources.

### Milestone 5 — App › Logs

- `/apps/{id}/logs`: source selector (runtime, or a deployment's build log; default newest), status and connection state, toolbar (search with next/previous and match count, Pause/Resume with held-line notice, Follow toggle that turns off when scrolling up, Download, Clear for runtime).
- `logs.js` on xterm.js 5.5 + fit addon: subscribes first, then loads the stored snapshot (`GET /api/deployments/{id}/logs`) and appends buffered live lines not already in the snapshot tail; writes are chunked (64 KiB) and flushed per animation frame; finished builds load only the snapshot; runtime reconnects print a gap marker; `EventSource` reconnects with backoff and detects signed-out sessions.
- The logs page alone allows inline styles (xterm injects `<style>` elements); scripts stay nonce-only. Renamed the container class to avoid colliding with xterm's own `terminal` class.
- Tests: `web/logs_test.go` (default build source, runtime source, cross-app and unknown deployments → 404, per-page CSP, logs never inlined) and `e2e/logs.spec.js` (live build log through success without duplicates, runtime pause/resume, 50,000-line log: ~0.5 s to render locally, deep search, full download).

### Milestone 6 — App › Settings and new app

- Shared app form (create and edit): name, server (create only; moving is rejected by the service), repository, branch, Dockerfile, GitHub installation ID, build cache switch, domains (one per line), port, health path and timeout, memory (MiB), CPU (cores), replicas. Fields the form does not edit (such as `stopped`) are preserved.
- Environment variables: masked table (Runtime/Build), add/replace with password field and explicit reveal toggle, replace dialog, delete with confirmation, `.env` import; values never reach the browser after saving.
- Runtime: start, restart (confirmation), stop (confirmation), delete (requires stopped app and typing its name).
- Messages reflect agent behavior: runtime config/env changes roll out through reconciliation with a health-checked restart; build changes need a deployment.
- Members see a read-only configuration summary; `/apps/new` is 403 for members.
- Tests: `web/appsettings_test.go`, `web/appsettings_internal_test.go` (form parsing, `.env` parsing), `e2e/apps.spec.js` (create app, edit and persist settings; env var masked → revealed on request → saved write-only → replaced → deleted).

### Milestone 7 — Servers

- `/servers`: one card per server with status (online / offline / recovering), WireGuard address, agent version, heartbeat; live CPU and memory numbers plus a uPlot chart of samples received since the page opened (up to one hour); disk meter; build cache limit and concurrent builds; container table (app, CPU, memory, processes) from `metrics.containers`.
- `metrics.js` follows `/api/events?topic=servers` with reconnection and signed-out detection, marks servers offline on `server.offline`, and rebuilds charts on theme changes.
- Admin actions: **Add server** (dialog with suggested next 10.77.0.x address) → invitation card with install commands, one-time token, live countdown, and copy; **Limits** (builds 1–8, cache GiB); **Clear cache** and **Remove unused images** with confirmation.
- Cache usage is not reported by the agent (only the limit), so the page says so; listed as pending.
- Fixed: `closeAndReset` ignored the matched element itself, leaving a submitted dialog open with a cleared form.
- Tests: `web/servers_test.go` (page, member view, invitation command and one-time token, validation, permissions, limits, prune without agent, invalid scope) and `e2e/servers.spec.js` (live numbers, chart, containers, invitation with countdown and clipboard copy, cache cleanup confirmation).

### Milestone 8 — Settings

- Sub-navigation shows only sections the viewer may use; administrator pages return 403 for members.
- **Users**: list with roles; invite (email, name, role) → one-time enrollment token with countdown and copy; the person enrolls at `/enroll`.
- **Passkeys/TOTP/tokens**: on the Account page (milestone 2).
- **GitHub App**: manifest flow (`settings.js` posts the panel's manifest to GitHub; CSP `form-action` allows github.com), credential status, webhook URL, manual credential entry (only filled fields are saved; values never displayed).
- **Notifications**: empty state; external notifications are a phase-2 backend feature.
- **Backups**: back up now (fresh session required; re-authentication dialog otherwise), operations table that polls every 4 s while jobs run (there is no operations event stream), S3 configuration (write-only; replaces the whole configuration).
- **Audit log**: filters by action, user, target substring, and whether to include `http.request` rows (hidden by default because every mutation also records one); presentation-only filtering over the newest 1000 entries, 200 shown.
- **Platform**: current version, update with confirmation (`vX.Y.Z`), operations with batch cancellation.
- Tests: `web/settings_test.go` (permissions, user invite, GitHub credentials never echoed, backups and duplicate protection, S3 validation and secrecy, re-authentication signal, update validation/queue/cancel, audit filters) and `e2e/settings.spec.js` (invitation → enrollment with a virtual authenticator in a second browser → one-time token reuse rejected → member sign-in with restricted settings → audit entries; GitHub manifest POST captured by route; real dev backup polled to completion; update rejected without a release identity).

### Milestone 9 — Command palette

- Ctrl/⌘+K or the top-bar button opens a combobox + listbox dialog; entries load lazily from `/ui/cmdk` (filtered by role) and are filtered client-side by words in labels, hints, and keywords.
- Groups: Go to (pages, settings sections), Apps (deployments, build logs, runtime logs, settings per app), Deploy (redeploy each app's newest SHA through the same CSRF-protected action), Actions (new app, add server, invite user, light/dark/system theme, sign out). No AI.
- Keyboard: arrows with wrap-around, Enter runs, Escape closes; `aria-activedescendant` tracks the selection; hover also selects.
- Fixed: the palette's deploy action pointed at `/apps/{id}/deploy` instead of `/ui/apps/{id}/deploy` (caught by the handler test).
- Tests: `web/cmdk_test.go` (entries, role filtering, no empty Datastar attributes, authentication) and `e2e/cmdk.spec.js` (filter → navigate, arrow keys → deploy action → toast, theme switch, empty state, Escape).
- Test hygiene: `<dialog>` boxes are zero-sized (their panel is fixed), so `toBeHidden()` on the dialog was trivially true; assertions now target content inside dialogs.

### Milestone 10 — Polish

- Accessibility: axe-core (WCAG 2.2 A/AA, including contrast) passes on 17 screens in both themes and with confirmation dialogs and the command palette open. Light-theme muted text, warning, and destructive tokens were darkened slightly (dark values re-declared) to reach 4.5:1 on tinted backgrounds. Command palette options no longer nest links or buttons.
- Keyboard: skip link to `#main`, visible focus on every control, native dialog focus trap with focus returning to the trigger, Escape closes dialogs and the mobile menu, focus moves into the mobile menu and back to its toggle.
- Disconnection: dedicated tests stop and restart a separate panel while the dashboard stream and a log `EventSource` are open; both show Reconnecting…, recover to Live, reload the snapshot, and mark the runtime log gap. Revoking the session elsewhere sends the page to sign-in at the next keepalive. Offline emulation was rejected as a test method because Chromium keeps open loopback streams alive.
- Error states: HTML 404 page inside the shell for unknown pages (API and asset paths keep plain 404s); finished log streams show a neutral state instead of an error color.
- Layout: settings navigation wraps on phones instead of hiding items; command palette gap removed.
- Performance: cold-cache first contentful paint under 1 s on five pages (16–60 ms locally); asset budget test reports 98.9 KB JavaScript and 18.5 KB CSS (Brotli).
- Screenshots: 52 images in `docs/screenshots` (every screen in both themes, dialogs, palette, phone views).
- Final checks: clean-copy `make build test lint` passes; race detector on web/httpapi/service passes; govulncheck reports no reachable vulnerabilities; 29 Playwright tests pass. Report: `docs/frontend-report.md`.

### Redesign and UX review (after milestone 10)

- New visual language from the maintainer's reference (see decisions): icon rail and phone tab bar, rounded panel, pastel tiles, rows with action cells, floating **+**, self-hosted Outfit font, rounder Basecoat surfaces, adjusted light/dark tokens.
- UX review of every screen: deployment history as rows with a status thumbnail, stage chips (done/current), and Logs/Cancel/Roll back cells; app settings with section shortcuts and a sticky save bar; environment variables as rows; leaner servers header; sign-in and enrollment with a pastel header tile; Sign out also on the Account page; Appearance card for System/Light/Dark.
- Fixes found during the review: description-list misuse in tiles (axe), dark destructive contrast, spacing from in-page anchors, old Portuguese seed data in an existing `.local/dev` database (fresh dev directories are English; delete `.local/dev` to reseed).
- Checks: Go tests, golangci-lint, axe in both themes, and all Playwright specs pass; JavaScript 99.0 KB and CSS 20.2 KB (Brotli). Screenshots regenerated.

### Guided panel (all three stages of the proposal)

- Backend: agent failure codes, BuildKit cache usage in metrics (protocol field 9), team role changes and removal, repository inspection through GitHub (dev simulation included), DNS check, realistic development pipeline. Details in `docs/backend-changes.md`.
- Home: checklist, attention list, plain statuses, one action per app. App: Overview tab with live steps, failure explanation, usage, DNS check; History with "Restore this version". New app wizard with detection and immediate publish. App settings split into General and Advanced; variables pasted and reviewed before saving. Servers: cache meter and a single "Free up space" dialog. Settings regrouped into Account, Team, Connections, Activity, System; team roles and removal.
- Performance: per-page JavaScript budget test, Speculation Rules prefetch, subset font, LCP/CLS checks. Writing guide in `docs/ui-writing.md`. Opt-in visual regression for the gallery.
- Checks: see the report. The real-BuildKit integration test was not run because the Docker daemon is stopped on this workstation.
