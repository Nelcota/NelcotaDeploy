# Service and API contract

How pages and API clients use the panel's services: methods, permissions, DTOs, authentication, events, and HTTP routes.

The web extension point is `web.Register(r chi.Router, cfg web.Config)`, called by `internal/httpapi.New`. `web.Config` carries `Services`, the panel `Origin`, `Dev`/`DevLogin`, `Version`, `CSRFToken(*http.Request)` (the token bound to the session cookie), and `Authorized(*http.Request)` (stream revalidation). The templ/Datastar interface lives in `web/` ([web/README.md](../web/README.md)). Process composition belongs in `cmd/`; pages must not contain business rules.

## Conventions

All methods take `context.Context` first. Pass `r.Context()` through to services; do not use `context.Background()` in handlers. Public DTOs and interfaces live in `internal/service/types.go` and `auth.go`; `internal/store/dbgen` types are backend-only. JSON fields use snake_case. Entity timestamps are Unix seconds; stage durations are milliseconds. IDs are opaque strings. Deployment SHAs must contain all 40 or 64 hexadecimal characters; pages resolve shorter ones through `Repos.Commit` first.

`service.Services` exposes `Apps`, `Deploys`, `Servers`, `Logs`, `Auth`, `Users`, `Settings`, `Audit`, and `Operations`, plus the optional `Repos`, `Notifications`, and `Provisioning` (nil when unavailable; they have no REST routes). Interfaces support frontend test doubles. Development mode uses real SQLite services and simulated agent transport.

`service.CurrentUser(ctx)` returns `Principal{ID, Email, Name, Role, Scopes, TwoFactorAt, IP}` or Unauthenticated. Middleware loads identity from the session cookie; never accept identity/role from a header or form field. `WithPrincipal` is a trusted composition helper, not a login mechanism.

## Errors

Inspect `*service.Error{Kind, Message}` with `service.Is(err, kind)` or `errors.As`. JSON errors use `{"code":"validation","message":"..."}`. Display only typed public messages; internal failures receive a generic message, never database/SDK `err.Error()` output.

| Kind | HTTP | Meaning |
| --- | ---: | --- |
| Unauthenticated | 401 | Missing or invalid login, challenge, or session |
| Forbidden | 403 | Insufficient role, rejected CSRF token, or origin |
| NotFound | 404 | Entity does not exist |
| Validation | 400 | Invalid input or missing confirmation |
| Conflict | 409 | State or uniqueness conflict |
| Unavailable | 503 | Agent or integration unavailable |

Malformed JSON returns 400; invalid Content-Type returns 415; rate limiting returns 429 with Retry-After. Request bodies are limited to 1 MiB. Services enforce authorization independently of HTTP handlers. `admin` and `member` have installation-wide application access; this version has no teams or per-app ACLs.

## Services and permissions

| Service | Methods | Permission |
| --- | --- | --- |
| Apps | `List() []App`, `Get(id) App` | Authenticated user |
| Apps | `Create(AppInput) App`, `Update(id, AppInput) App`, `Delete(id, confirmed)` | Admin; deletion requires a stopped app and no active queue |
| Apps | `Environment(id) []EnvInfo`, `SetEnvironment(id, []EnvInput)` | Admin; listing never returns secret values |
| Apps | `Action(id, action, replicas, confirmed)` | Admin; start/stop/restart/scale; stop requires confirmation |
| Deploys | `List(appID) []Deployment`, `Get(id) Deployment` | Authenticated user |
| Deploys | `Enqueue(DeployInput) Deployment`, `Cancel(id)`, `Rollback(appID, sha) Deployment` | Authenticated user |
| Deploys | `SuggestedPort(id) uint32` | Authenticated user; for a `health_no_response` failure, the port the app's log says it listens on when it differs from the configured one, else 0 |
| Deploys | `PublishOnPort(id, port) Deployment` | Admin (`apps:write` and `deploys:write`); a failed deployment only. Changes the app's port and queues the same commit in one transaction; audited as `app.port` and `deploy.enqueue` |
| Servers | `List() []Server` | Authenticated user |
| Servers | `Invite(ServerInput) Invitation`, `Prune(id, scope, confirmed)` | Admin; prune requires confirmation; scope is cache/orphan_images |
| Logs | `Read(deployID) []byte`, `Subscribe(topic) events.Subscription` | Authenticated user |
| Users | `List() []Principal`, `Create(UserInput) Enrollment`, `SetRole(id, role)`, `Remove(id)` | Admin; not yourself; keeps one administrator |
| Apps | `CheckDomains(id) []DomainCheck` | Authenticated user; resolves each domain |
| Auth (photos) | `SetAvatar(upload)`, `RemoveAvatar()`, `Avatar(userID) Avatar` | Own photo only, interactive session; any signed-in person may view |
| Notifications | `Get()`, `Save(NotificationInput)`, `Test()`, `EmailConfigured()`, `SendInvitation(to, name, token)` | Optional; admin; secrets never returned |
| Provisioning | `Script(token)`, `HostKey(SSHTarget)`, `Install(SSHInstall) jobID`, `Job(id)`, `Subscribe(id)` | Optional; admin; install needs a recent passkey sign-in |
| Operations (updates) | `Updates() UpdateStatus`, `SetAutomaticUpdates(bool)` | Admin; turning on needs a recent passkey sign-in |
| Settings (S3) | `TestS3(json)` | Admin |
| Repos | `Inspect(RepoQuery) RepoInfo` | Optional (nil without GitHub access); branches, head commit, Dockerfile, EXPOSE port |
| Repos | `Commits(RepoQuery) []Commit`, `Commit(RepoQuery, ref) Commit` | Optional; the branch's newest commits (up to `RecentCommits`), and the commit a SHA or 7+ character prefix names. Development mode returns a fixed sample history |
| Auth (preferences) | `Preferences() Preferences`, `HideFirstSteps()` | Own account; hiding the Home setup checklist needs an interactive session |
| Settings | `Get() SettingsView`, `Set(key, value)` | Admin; encrypted values; Get only lists configured keys |
| Audit | `List(limit) []AuditEntry` | Admin; limit 1–1000 |
| Audit | `RecordRequest(method, route, status)` | HTTP infrastructure; do not call from pages |
| Auth | Passkey, TOTP, session, and logout ceremonies | Rules below |
| Auth | `Factors() Factors`, `RemovePasskey(id)` | Own account, interactive session; removal needs a session reauthenticated within five minutes and keeps at least one passkey |

`SetEnvironment` applies a transactional patch: each item creates/replaces a key; `{key,delete:true}` removes it. Missing keys remain unchanged. This supports editing secrets without reading them. Never submit `********` as a previous secret. Limits: 200 keys and 512 KiB of encrypted values per app.

## Domain DTOs

- `App`: id, name, server_id, repository, branch, config, desired_sha, revision.
- `AppInput`: name, server_id, repository (HTTPS github.com), branch, and `AppConfig`. Changing an existing app's server requires a future migration operation and is currently rejected.
- `AppConfig`: domains[], memory_bytes, nano_cpus, port, health_path, health_timeout (seconds), replicas (1–16), cache_enabled, dockerfile, installation_id, stopped. Defaults: 256 MiB, 1 CPU, port 8080, `/`, 60 seconds, one replica, and `Dockerfile`. Set cache_enabled explicitly. Domains are DNS hosts without scheme/path/port.
- `EnvInput`: key, value, build, delete. `build=false` is runtime-only; `build=true` uses only the BuildKit secret provider through `RUN --mount=type=secret,id=KEY`. Never convert secrets to build ARGs.
- `EnvInfo`: key, build, configured. Values never return to the UI.
- `Deployment`: id, app_id, sha, message, author, origin, status, queued_at, started_at, finished_at, error_code (`clone_failed`, `build_failed`, `start_failed`, `app_exited`, `health_no_response`, `health_status_<code>`, `route_failed`, `state_error`, `workspace_error`, or panel codes `agent_unavailable`, `github_unavailable`, `config_unavailable`, `deployment_failed`), clean, cancel_requested, timings (stage-to-ms map). Stages: clone/build/start/healthcheck/route. Timings remain incomplete while running. States: queued/building/starting/success/failed/cancelled. Do not invent percentage progress.
- `DeployInput`: app_id, sha, message, author, origin (push/manual/rollback), clean. Normal UI actions use origin=manual. Rollback rebuilds a previous SHA; it does not switch to a retained image.
- `Server`: id, name, wireguard_ip, status, heartbeat_at, build_limit, cache_bytes, version, ready. Metrics arrive through the hub.
- `ServerInput`: name, wireguard_ip, build_limit (1–8, default 1), cache_bytes (default 5 GiB). The standard installer requires a unique address in 10.77.0.0/24.
- `Invitation`: server_id, token, expires_at (RFC3339). One-use server token, valid for 15 minutes. Display once; exclude from analytics, logs, and URLs.
- `UserInput`: email, name, role (admin/member). `Enrollment`: user_id, token, expires_at. A person's invitation is single use and lasts 24 hours (`service.InvitationLifetime`); only its hash is stored. The panel shows it once as a link, `{origin}/enroll#token=...`: the token travels in the URL fragment, which browsers never send to the server, and the enroll page moves it into the form and clears the address bar. The token can also be pasted at `/enroll`. The first administrator's installer invitation (`Bootstrap`) still lasts 15 minutes.
- `AuditEntry`: id, user_id, action, target, details (JSON), ip, created_at. `SettingsView`: configured[]; secrets are never returned.

GitHub settings: github.app_id, github.private_key, github.webhook_secret, github.client_id, github.client_secret. The Manifest handshake below is preferred.

## Sessions and CSRF

Production cookie `__Host-nelcota`: Secure, HttpOnly, SameSite=Strict, Path=/, no Domain, one-hour lifetime. The token is random; only its hash is stored. Development uses `nelcota_dev` without Secure, restricted to the 127.0.0.1 listener.

`GET /api/session` returns `{user, csrf_token}`. Authenticated POST/PUT/DELETE requests require the configured `Origin` and `X-CSRF-Token`. Go pages can obtain the token through this endpoint; do not expose HttpOnly cookies to JavaScript. Pre-login requests are protected by origin checks and the WebAuthn ceremony. Webhooks use HMAC; server enrollment uses a high-entropy invitation and does not accept cookie authentication.

Request human confirmation and send `confirmed=true` for delete, stop, and prune. The backend does not confirm these automatically. The protocol/API has no `exec` operation.

## WebAuthn JSON and browser flow

1. `nelcota-panel init --email ...` creates the first administrator enrollment, protected by the installer in `/etc/nelcota/first-access.json`. Admins can invite users through Users.Create. There is no public signup.
2. `POST /api/auth/register/begin` accepts `{enrollment_token}`. To add a passkey to the current account, send `{}` with a session reauthenticated within five minutes. Response: `Ceremony{ceremony_id, options, expires_at}`. `options` is the library's native object containing `publicKey`.
3. Convert base64url challenge, user.id, and credential IDs into ArrayBuffer. Browsers with `PublicKeyCredential.parseCreationOptionsFromJSON` can convert `options.publicKey` natively.
4. Call `navigator.credentials.create({publicKey})`. Use `credential.toJSON()` when supported; otherwise encode rawId, clientDataJSON, and attestationObject as base64url and include id, type, transports, and clientExtensionResults.
5. Send `{ceremony_id, credential}` to `POST /api/auth/register/finish`. Registration does not sign in. Invitation and challenge are consumed once.
6. `POST /api/auth/login/begin` accepts `{email}`. Convert `options.publicKey` with `parseRequestOptionsFromJSON` or fallback and call `navigator.credentials.get({publicKey})`.
7. Send `{ceremony_id, credential}` to `POST /api/auth/login/finish`, serializing rawId, clientDataJSON, authenticatorData, signature, userHandle, and extensions as base64url. The server checks origin, RP ID, user verification, signature, and counter.
8. Without TOTP, the response sets the cookie and returns expires_at. With TOTP, it returns `{requires_totp:true, challenge}` without creating a session.
9. `POST /api/auth/totp/verify` accepts `{challenge, code}` and sets a cookie only after verification. Previously used codes are rejected. Fetch `/api/session` before authenticated navigation.
10. To enable TOTP, use a recent session with `POST /api/auth/totp/begin`, which returns `{id,url}`. Display the otpauth QR/secret only here. `POST /api/auth/totp/finish` with `{id,code}` verifies before persistence and revokes previous sessions, API tokens, and challenges. Sign in again with passkey + TOTP, then generate recovery codes.
11. `POST /api/auth/logout` revokes the session and clears its cookie.

Keep challenges in memory during ceremonies, never URLs/localStorage. Exclude WebAuthn responses, tokens, environment values, and otpauth URLs from frontend logs. The backend tests ceremonies with a virtual ECDSA authenticator; real browsers/passkeys still require validation.

## GitHub App Manifest

`POST /api/github/manifest` requires admin + CSRF and returns `{action,manifest,expires_at}`. Create a POST form using the returned action and hidden field `manifest=JSON.stringify(manifest)`, then submit through the browser. The action includes random state bound to the administrator for ten minutes.

GitHub returns to GET `/api/github/callback?state=...&code=...`. The backend consumes state, exchanges code, and encrypts five credentials. Browsers are redirected to the App's installation page (`installation_url`); requests with `Accept: application/json` receive it as JSON. After installation, the manifest's `setup_url` returns people to Settings › Connections. State is required because SameSite Strict may omit the cookie on return. Each app's installation ID is found automatically through the App, or from signed push webhooks. `/api/webhooks/github` validates HMAC SHA-256 in constant time and deduplicates X-GitHub-Delivery within the queue transaction. A durable outbox retries check runs without blocking agent events.

## Events and SSE

`services.Logs.Subscribe(ctx, topic)` returns `events.Subscription{C,Cancel}`. Always `defer sub.Cancel()` and select `ctx.Done()`. Capacity is 128 events. When full, the hub closes the channel and disconnects the consumer without blocking producers. `events.Event` contains ID (process-local sequence), Topic, Kind, Time, and immutable JSON Data ([]byte). Copy Data before retaining/mutating it.

| Topic | Kind | Data |
| --- | --- | --- |
| apps | app.updated | App |
| deployments | deploy.queued / deploy.status | Deployment |
| deploy/ID | deploy.log | `{line,sequence}` |
| deploy/ID | deploy.status | Deployment |
| deploy/ID | deploy.stage | `{stage,duration_ms}` |
| app/ID | runtime.log | `{line,sequence}`; real runtime sequence may be zero |
| servers | server.metrics | `{server_id,metrics}` with cpu_percent, memory_used/total, disk_used/total, network_rx/tx, cache_used |
| servers | server.offline | `{id}` |
| servers | container.event | Container event when provided by transport |

Use EventSource with the session cookie at `GET /api/events?topic=...`; never place a token in the query string. Keepalive is 15 seconds; write timeout is five seconds. Each keepalive revalidates the session/token and closes on expiration, revocation, or permission changes. Expect disconnects: after reconnect, reload app/deployment/server snapshots and persisted logs. SSE IDs are not persisted; Last-Event-ID does not guarantee replay. Initially call `Logs.Read(deployID)` (4 MiB limit), then follow the stream and tolerate overlap. Disk retention is the last 50 completed deployments per app, stored as zstd files outside SQLite.

The first app/ID subscriber requests runtime follow from the agent; subscribers share it and the last cancellation stops follow. Metrics arrive every 15 seconds, heartbeat every five, and desired-state requests every ten.

## Domain endpoints

- Apps: GET/POST `/api/apps`; GET/PUT/DELETE `/api/apps/{id}`; GET/PUT `/api/apps/{id}/env`; POST `/api/apps/{id}/actions` with `{action,replicas,confirmed}`.
- Deploys: GET `/api/apps/{id}/deployments`; POST `/api/deployments`; GET `/api/deployments/{id}`; POST `/api/deployments/{id}/cancel`; GET `/api/deployments/{id}/logs` returns `{text}`. REST rollback posts a deployment with origin=rollback and the previous SHA.
- Servers: GET `/api/servers`; POST `/api/servers/invite`; POST `/api/servers/{id}/prune` with `{scope,confirmed}`. Installer-only POST `/api/servers/join` accepts `{token,wireguard_public_key}`.
- Users: GET/POST `/api/users`; PUT `/api/users/{id}/role` with `{role}`; DELETE `/api/users/{id}`. Settings: GET `/api/settings`, PUT `/api/settings/{key}` with `{value}`. Audit: GET `/api/audit`.
- GET `/healthz` is public without infrastructure details. `/agent.sh` serves the embedded installer.

Success responses use HTTP 200. Pages can call services directly without a round trip through their own API.

## Development without VPS infrastructure

`make dev-seed` creates/updates `.local/dev`. `make dev` serves only `http://127.0.0.1:8080` (override with `NELCOTA_DEV_ORIGIN` and a loopback `NELCOTA_DEV_LISTEN`, for example `http://localhost:18080` for passkeys), with sample apps, servers, and deployments, simulated logs, and varying simulated metrics, without Docker/GitHub. POST `{}` to `/api/dev/session` with the correct Origin, then fetch `/api/session`. The dev endpoint is absent from serve mode. Simulated deployment, log, and metric behavior does not represent real performance.

## Scoped API tokens

Auth exposes `CreateToken(ctx, TokenInput) APIToken`, `Tokens(ctx) []APIToken`, `RevokeToken(ctx,id)`, and `AuthenticateToken(ctx,raw) Principal`. HTTP: GET/POST `/api/tokens`, DELETE `/api/tokens/{id}`. Creation requires admin in an interactive session reauthenticated within five minutes; tokens cannot issue tokens. Listing/revocation also requires an interactive session. Raw tokens appear only at creation; SQLite stores SHA-256. Lifetime defaults to 24 hours, maximum 720 hours, with immediate revocation.

`TokenInput`: name, scopes[], ttl_hours. `APIToken`: id, name, scopes, expires_at (Unix seconds), token (creation only). Use `Authorization: Bearer ...`; explicit header authentication bypasses cookies/CSRF/Origin. Invalid bearer authentication never falls back to cookies. Never place tokens in URLs.

Scopes: apps:read, apps:write, deploys:read, deploys:write, servers:read, servers:write, logs:read, users:write, settings:write, audit:read. `:write` includes read access in the same domain. Roles remain enforced; scopes do not remove admin requirements. Cross-domain operations also require the corresponding read scope. Programmatic deployment needs `apps:read` and `deploys:write`; deployment logs need `deploys:read` and `logs:read`; runtime logs need `apps:read` and `logs:read`. Treat `users:write`, which can create accounts, as a high administrative privilege.

## Administrative operations and recovery

`Services.Operations` exposes List(ctx), Backup(ctx), Update(ctx,version), and Cancel(ctx,batch). Backup/Update create persisted jobs; poll List for results. There is no operations SSE event. Mutations require admin and interactive reauthentication within five minutes; API tokens are rejected. List allows admin with settings:write.

| Method/route | Input | Output |
| --- | --- | --- |
| GET /api/operations | — | Last 100 Operation entries |
| POST /api/operations/backup | — | Queued Operation |
| POST /api/operations/update | version, such as v1.2.3 | Ordered []Operation; agents then panel |
| POST /api/operations/{batch}/cancel | — | ok; conflict if a stage is running |
| PATCH /api/servers/{id}/limits | build_limit, cache_bytes | Server; admin servers:write |
| POST /api/auth/recovery-codes | — | Ten codes, shown once |
| POST /api/auth/recovery/verify | challenge, code | LoginResult/cookie; replaces TOTP only after passkey |
| POST /api/auth/totp/reset | — | ok; revokes sessions/tokens and requires login |

Operation: id, batch, kind (backup/update), target (server ID or panel), version, status (queued/waiting/applied/failed/cancelled), created_at/started_at/finished_at in Unix seconds, and public error_code. waiting means running; applied means complete. Failure stops the rest of the batch. Offline servers wait and can be cancelled before execution. Agent updates complete only after helper confirmation, the new version, and readiness. The panel updates last after creating a backup. CLI updates follow the same idle policy.

Auth adds RecoveryCodes(ctx), VerifyRecovery(ctx,challenge,code), and ResetTOTP(ctx). Generating/resetting requires the user's recent interactive session, without bearer. Configure TOTP before generating codes. After requires_totp, offer recovery as an alternative while retaining the passkey challenge. Codes cannot be submitted without that challenge. Codes are single-use; regeneration invalidates previous codes. Reset revokes the current session; redirect to login.

Servers adds UpdateLimits(ctx,id,ServerLimitsInput), version, and ready. BuildLimit is 1–8; cache is 64 MiB–100 GiB. Changes arrive within the ten-second snapshot; active builds continue. ready=false blocks new claims during state recovery.

`server.metrics` retains server_id and metrics. metrics.containers contains up to 256 entries: app_id, container_id, cpu_percent (100% per core), memory_used (excluding inactive cache), memory_limit, network_rx, network_tx, pids. The first CPU sample may be zero; snapshots are not persisted as a time series.

S3 configuration: PUT `/api/settings/backup.s3` takes value as a JSON string with HTTPS endpoint, region, bucket, prefix, access_key, secret_key, and optional session_token. Get reports presence only. Never populate inputs with an existing secret. A mode 0600 environment-configured file takes precedence. Backups have no public download endpoint and never expose keys through the API. See [operations](operations.md).
