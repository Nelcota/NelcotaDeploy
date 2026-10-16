# Technical decisions

Choices that are not obvious from the code, with their reasons. The original design is in the [system plan](system-plan.md).

## Initial scope

Version 1 requires a Dockerfile; automatic detection waits for audited templates. Admin and member roles are supported. Remote `exec` is excluded. Control uses bidirectional ConnectRPC over HTTP/2, superseding the early roadmap's WebSocket reference.

## Security and operational boundaries

- Sessions last one hour. Passkeys require user verification. Configured TOTP is mandatory before session issuance. User and server invitations are separate; there is no public signup or default password.
- Public APIs listen on loopback behind Caddy. RPC uses a separate WireGuard-address listener with mTLS. X-Forwarded-For is accepted only from loopback, assuming Caddy overwrites external headers.
- Audit writes share domain-mutation transactions; SQLite triggers reject UPDATE/DELETE. Root access to the database is outside this guarantee.
- An encrypted swap intent is persisted before route changes. Old containers remain journaled until removal. Heartbeats report observed versions to repair lost terminal events. Command-ID replay history survives restarts.
- Runtime UID/GID is always 65532, rootfs is read-only, and `/tmp` is bounded. Additional writable storage requires an explicit future decision; do not automatically relax isolation.
- Build concurrency defaults to one. Administrators may choose two for larger VPS instances at enrollment; no unmeasured automatic tuning.

## Supply chain and installers

No production release domain or signing identity exists yet. Installers require an HTTPS release URL and a Minisign key distributed through a trusted channel. They verify signed SHA-256 manifests before installing binaries. BuildKit daemons are included in the signed bundle; maintainers must verify their provenance first. `scripts/release.sh` packages and signs locally without publishing; `release.yml` publishes ([development](development.md#releases)).

Installers refuse existing Caddy/WireGuard configuration, require tested SSH key access, preserve data, and do not upgrade active installations. Real-system acceptance follows the [VPS guide](vps-testing.md).

## Measured zstd optimization

On a Ryzen 7 9700X with Go 1.26.9 and `/tmp`, a new encoder per line cost 29,070 ns/op, 644,586 B/op, and 22 allocs/op. Encoder/buffer pooling measured 1,437 ns/op, 298 B/op, and five allocs/op while preserving concatenated frames and round-trip correctness. Optimization followed measurement; it does not establish VPS latency or memory performance.

## Verified technical references

- [Connect protocol and HTTP/2 requirement for bidirectional streams](https://connectrpc.com/docs/protocol/).
- [Caddy API: PATCH, POST, IDs, persistence, and concurrency](https://caddyserver.com/docs/api).
- [Official Go distributions](https://go.dev/dl/): downloaded Go 1.26.9 was checked against its published checksum.

## Vulnerability-driven dependency updates

Initial govulncheck v1.9.0 analysis reported 25 dependency-symbol findings. Updates included BuildKit v0.34.0, maintained Moby client module `github.com/moby/moby/client` v0.6.2, API v1.56.1, containerd, gRPC, x/net, OpenTelemetry, and related dependencies. The driver uses `fsutil.FS` instead of removed BuildKit LocalDirs. fsutil and containerd/errdefs come from the official APIs.

Repeated analysis found zero reachable-symbol or imported-package vulnerabilities, with one required-module warning lacking an import/call path. Exact versions are recorded in go.mod/go.sum. Installers use Docker's official apt repository with a pinned signing fingerprint, not get.docker.com. References: [Debian](https://docs.docker.com/engine/install/debian/), [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## Queue, logs, and UI boundaries

- Check runs use a SQLite outbox and retry worker. Slow GitHub calls do not block agent heartbeat/log handling. Installation-token transport is covered by simulated HTTP tests.
- Environment updates patch individual keys with explicit deletion. Frontends can update secrets without reading/resending existing values. Aggregate limits stay below protocol bounds.
- API tokens enforce service-level scopes, a maximum 30-day lifetime, stored hashes, and revocation. New tokens require recent interactive authentication; bearer tokens cannot mint broader tokens.
- Log rings are bounded by count and bytes (1 MiB per deployment). Transport reserves status/heartbeat capacity. Saturated logs do not cancel builds. Browser streams are ephemeral and need snapshot reload after reconnection.
- BuildKit cache GC independently enforces seven-day age and total-size limits, so recent cache cannot exceed the size cap indefinitely.

## Integration tests

Integration uses application bridges without published ports. Test Caddy uses host networking with loopback listeners, matching production's native proxy. Test BuildKit requires explicit OCI privilege in HostConfigModifier because that modifier replaces legacy defaults. Only the test builder is privileged. Applications are inspected for non-root, unprivileged, cap-drop ALL, read-only rootfs, CPU/RAM limits, and no port bindings. Tests exercise real traffic during route swaps and cleanup of old containers/images.

## Operations and memory after profiling

- RSS overhead came mainly from WASM compiler scratch space. One startup `debug.FreeOSMemory` call preserves the driver/query pool. Agent telemetry descriptors are warmed first; default GOGC=50 honors overrides. Both systemd services set `GODEBUG=disablethp=1` for small heaps, following the [Go guide](https://go.dev/doc/gc-guide#Linux).
- Backups use VACUUM INTO, streaming tar, bounded AES-GCM blocks, per-file keys, and authenticated completion. The independent backup key is excluded from tar and supplied separately during restore. Integrity/encrypted-field validation happens before replacement; a lock and durable marker prevent partial startup.
- S3 uses HTTPS path-style PutObject with signed SigV4 payloads in the standard library. The limited operation does not require a full SDK. Tests cover an official AWS vector and local TLS uploads. Configuration comes from mode 0600 files or encrypted settings.
- Updates accept newer stable versions and prehashed ED Minisign manifests, including trusted comments. Root helpers have fixed commands/destinations and revalidate downloads. os.Root confines requests/results. Coordinators enforce idle state, order, readiness, and confirmation. Agent CLI updates reserve maintenance over mTLS.
- Certificate renewal preserves CA/identity, atomically saves new pairs, and allows seven days of retry using the previous fingerprint. Pending panel pairs are encrypted. The five-year CA does not rotate peer trust automatically.
- Metrics cap samples at 256 containers with four concurrent calls and a ten-second budget. Official Dockerfile parsing handles default ARGs without executing commands. Tagged bases are materialized in BuildKit; digest pins remain immutable.

## Public repository conventions

The repository uses MIT licensing and English for all project text and GitHub activity ([AGENTS.md](../AGENTS.md)); the only exception is the Portuguese interface catalog `web/i18n/pt_br.go`. Commit messages were translated to English and attributed to HanielCota on October 15, 2026, which changed commit IDs. Signed historical artifact identifiers were left unchanged; see [staging releases](staging-releases.md).

## Interface

Ambiguous interface choices were resolved with the simplest clear option.

- **CSP without eval.** Pages send a per-request nonce and render `<html data-nonce>`, which switches Datastar 1.0.4 into its nonce mode (expressions compile into nonce-bearing scripts). `unsafe-eval` is never allowed. Only the logs page adds `style-src 'unsafe-inline'`, because xterm.js injects `<style>` elements. Markup never uses `style=""`; meters use `<progress>`.
- **Mutations through Datastar.** Forms post as `application/x-www-form-urlencoded` with the `X-CSRF-Token` header from a page signal (`$_csrf`, underscore signals are never sent). Responses are Datastar SSE patches; errors show the service's typed message as a toast, never internal details. WebAuthn ceremonies call the documented `/api/auth/*` JSON endpoints from `auth.js`.
- **Live views.** Page-level streams (`/ui/stream/...`) render HTML on the server from service reads and patch it; every connection starts with a full snapshot, satisfying the contract's "reload after reconnect". Logs and charts use `EventSource` on `/api/events` directly. Dialogs are excluded from morphing so updates never close them.
- **Quick deploy.** **Publish latest** publishes the branch head when the panel can read the repository through GitHub, and otherwise rebuilds the newest deployment's SHA; **Publish a commit** takes an explicit full SHA.
- **Write-only secrets.** The contract never returns environment values, so "reveal" applies to values being typed (password fields with an explicit eye toggle). Existing values show as `••••••••` with **Replace** and **Delete**. No reveal endpoint was added.
- **Rollback.** Offered for earlier successful deployments; the confirmation states that it rebuilds the commit (no retained images).
- **Terminal theme.** The log viewer is dark in both themes for contrast and familiarity; surrounding chrome follows the theme.
- **Library versions.** xterm.js 5.5.0 (56 KB Brotli) instead of 6.0.0 (75 KB) to meet the 100 KB JavaScript budget; the search addon is replaced by a small buffer search. Datastar comes from its GitHub release (npm has only betas) and is pinned by SHA-256.
- **Form reset.** Datastar morphing keeps typed values, so forms are reset and dialogs closed by a server-sent expression only after an action succeeds; failed submissions keep the input.
- **Accessible color tokens.** Basecoat's light `--muted-foreground` and `--destructive`, and the panel's status colors, are darkened just enough to pass WCAG AA for 12 px text on muted and tinted backgrounds; dark-theme values are unchanged.
- **Command palette semantics.** A combobox controls a listbox; options carry their target (`data-href` or an action) instead of nesting links or buttons, which axe rejects inside `role="option"`.
- **Reconnection tests.** Network loss is simulated by stopping and restarting a separate development panel, because Chromium's offline emulation does not close open loopback streams.
- **Not-found pages.** Unknown page paths render the panel's 404 page; `/api/`, `/ui/`, and asset paths keep plain 404 responses so API behavior is unchanged.
- **Screenshots in Git.** `docs/screenshots` documents every screen in both themes and on a phone; `make screenshots` regenerates it in the pinned Playwright container.
- **Visual design.** The shell uses a quiet frame with an icon rail (labels under icons; a bottom tab bar on phones), one large rounded content panel, pastel stat tiles, rounded list rows with a thumbnail, a status bar, and action cells on the right. Apps, deployments, servers, and environment variables use rows instead of tables; dense data (audit log, tokens) stays tabular. The Outfit variable font (SIL OFL 1.1, 31 KB woff2) is self-hosted to keep `font-src 'self'`. Indeterminate stripes on active rows show activity without inventing progress; stage chips show measured durations only.
- **Plain interface copy and no decoration.** Generic decorative patterns were removed: uppercase letter-spaced micro-labels, decorative icons in tiles and row metadata, the redundant ring and dashed call-to-action tile, the floating button (the header's **New app** remains), pulse animations, and a hero tile on sign-in. Copy was shortened to direct sentences without marketing phrasing or em dashes; confirmations state the consequence in one line.
- **Guided panel.** The interface should decide for the person where it can:
  - *Home:* a first-run checklist derived from existing data, a "Needs your attention" list (failed releases, offline or recovering servers, disks at 90% or more), and apps with a plain status and one primary action. Counter tiles were removed: they answered "how many", not "what now".
  - *App page:* a new Overview tab (what is online, the deployment in progress with named steps and the previous duration, a failure card with the step, cause, fix, and highlighted log lines). Deployments became History.
  - *New app:* a two-step wizard. The panel reads the repository (branches, head commit, Dockerfile, EXPOSE port); "Create and publish" creates the app and publishes the head commit. Without GitHub access it asks for the values.
  - *Settings:* the app form shows name, branch, addresses, port, and health path; everything else is under Advanced. Variables are pasted, reviewed as a diff, then saved. Settings has five groups: Account, Team, Connections, Activity, System; notifications and backups pages moved.
  - *Vocabulary:* see [the writing guide](ui-writing.md).
  - *Performance:* a per-page JavaScript budget (20 KB for most pages, 40 KB servers, 80 KB logs), hover prefetching with Speculation Rules (verified: navigations are served from prefetch), a subset font (22 KB instead of 32 KB), and LCP/CLS budgets in browser tests.
  - *Visual regression:* opt-in (`VISUAL=1`) for the component gallery, because baselines depend on the platform's font rendering.
- **Interface languages and mascot.** English and Brazilian Portuguese, switched with country flags; the Nelco mascot is the logo.
  - *Rule change:* AGENTS.md now allows Portuguese in `web/i18n/pt_br.go` only. English stays the source language for code, tests, documentation, and commits.
  - *Mechanism:* English strings are catalog keys (no message IDs), so untranslated text falls back to English and templates stay readable. Values are filled after translation (`Tf`). Durations and counts use a one-number pattern fallback instead of plural rules, which Portuguese and English need only for "(s)" forms already written that way.
  - *Choice and detection:* cookie, then `Accept-Language`, then English. Switching is a plain link (`?lang=`) that sets a one-year, HTTP-only, SameSite=Lax preference cookie and redirects to the same address. It changes no server state, so it needs no CSRF token, and it is excluded from Speculation Rules so hovering cannot switch the language.
  - *Flags:* the United States flag for English and the Brazilian flag for Portuguese, drawn as small inline SVGs and always paired with the language's own name, because a flag alone names a country, not a language.
  - *Scripts:* pages in Portuguese embed a JSON catalog of the strings scripts render (3.6 KB before compression); English pages embed nothing.
  - *Font:* the subset now includes the accented letters Portuguese uses and `›` (24 KB, up from 22 KB).
  - *Mascot:* a 128 px transparent PNG (15 KB) replaces the rocket mark in the rail, top bar, and sign-in page; a 64 px version is the favicon. PNG assets are not recompressed.
  - *Placement:* preferences stay out of the sidebar. Language and theme live to Settings › Account › Preferences (a segmented language control with flags and the theme select). The rail keeps navigation, the account link, and sign-out; the sign-in pages keep the flag menu and theme toggle because there are no settings before signing in.
- **Sidebar.** Navigation sits right under the mascot with tighter spacing instead of floating in the middle; icons are 20 px with stronger inactive contrast; the current page has a stronger tile and medium weight. The initial and the separate sign-out button became one account menu (name, email, My account, Sign out), also in the phone top bar, so signing out takes a deliberate second click. Each destination has a "g" shortcut (G H Home, G A Apps, G S Servers, G C Settings), announced with `aria-keyshortcuts` and shown after a short hover or on keyboard focus; shortcuts are ignored while typing or with a dialog open. A red dot marks Home when its attention list has items and Servers when one is offline or recovering, computed with the attention rules on each page load (disk usage needs live metrics, so only Home's list shows it). In Portuguese, Settings is "Ajustes", which fits the rail.
- **Profile photos.** Photos are stored in the database (included in backups, no new storage to manage) as 256 px JPEGs re-encoded by the service. The browser crops and shrinks the chosen image to 512 px before uploading, so phone photos fit under the panel's 1 MiB request limit without raising it; the server never trusts that step. Photos are served from `/avatars/{id}?v=…` to signed-in people only, cached as immutable for the exact version, with a sandboxing policy. They show in the account menu, the account page, and the team list; without one, the initial stays. To stay under the 100 KB JavaScript budget, the asset pipeline now drops full-line `//` comments from the panel's own scripts (never from vendor files or code lines); the sources keep their comments.
- **Automation.** These steps are automatic: the GitHub App installation for each app, the return from GitHub after creating the App, `.env.example` and `HEALTHCHECK` detection, a single retry of traffic-switch failures, removing unused images on full disks, DNS checks when the overview opens, update checks (and optional automatic installation), notifications by webhook or email, invitation email, weekly test restores, S3 connection tests, the release values in the install script, and installing an agent over SSH. Deleting apps or people, restores, role changes, and rollbacks stay manual on purpose: they are destructive or security decisions. Details are in [operations](operations.md#automatic-jobs); developer automation is in [development](development.md).
