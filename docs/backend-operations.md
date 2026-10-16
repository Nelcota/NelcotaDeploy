# Backend operations

## Memory

On October 15, 2026, the same local scenario—development login, three apps, nine log reads, eight concurrent API reads, and active pprof/flight recorder—improved from 119.2 MiB warmed RSS / 115.6 MiB after GC to 49.8 / 50.5 MiB. Profiling showed approximately 100 MiB of startup allocations, mainly SQLite WASM compilation, but only 9.4 MiB of live heap. `store.Open` returns temporary pages once after startup; no forced GC occurs on query paths. Profiles in `.local/profiles/` must not be published with real data.

Explicit local diagnostics: `nelcota-panel dev --pprof-listen 127.0.0.1:6069 --wg-interface lo`. Keep production diagnostics on WireGuard. With real Docker/BuildKit, mTLS, and two telemetry samples, agent RSS decreased from 32 MiB to 27.3 MiB after startup/GC changes and 24.6–25.0 MiB with `GODEBUG=disablethp=1`. Services set this option to avoid THP amplification for small heaps; the test host used THP always. The agent defaults to GOGC=50 and honors an explicit override. Panel RSS after a complete API backup was 46.7–53.5 MiB with diagnostics active. These are local results, not VPS acceptance. See the [Go Linux/THP guide](https://go.dev/doc/gc-guide#Linux).

## Backup and restore

Initialization creates `backup.key` (32 bytes, mode 0600), independent of `master.key`. Keep a copy outside the server and bucket. The key is excluded from backups. A backup contains a consistent SQLite `VACUUM INTO` snapshot and regular configuration files; logs and Docker images are excluded. The `.nbk` format uses a per-file derived key, bounded AES-256-GCM blocks, and an authenticated final marker. Truncation, reordering, and modification fail before destination changes. Creation and restore limit the tar to 4 GiB and 4,096 files, SQLite to 2 GiB, and each configuration file to 32 MiB.

```bash
nelcota-panel backup --output /path/new.nbk
nelcota-panel backup --output /path/new.nbk --s3-config /etc/nelcota/backup-s3.json
# Stop the panel before replacing an existing installation.
nelcota-panel restore /path/new.nbk --key-file /separate-copy/backup.key --replace
```

Restore accepts empty destinations without `--replace`, checks SQLite integrity and references, rejects schemas newer than the executable, and verifies every encrypted secret, including pending renewal certificates. Writes are confined by destination-directory descriptors even if paths change during the operation. Replacements retain `.before-restore` copies. A process lock prevents restore while the panel runs. A durable marker blocks startup after an interrupted replacement; repeat the same restore to finish. Running as root preserves destination ownership, including new subdirectories. On a new machine, verify owners and addresses before startup. Restore recreates `backup.key` from the operator's separate copy so subsequent backups work; the key is not read from the tar. Restored files use mode 0600. Remove previous copies only after verification.

The production worker makes one backup per UTC day in `data-dir/backups`, retains seven days locally, and retries hourly on failure. Upload is complete only after a 2xx response. Set `NELCOTA_BACKUP_KEY_FILE` to keep the key outside `config-dir`; set `NELCOTA_BACKUP_S3_CONFIG` for S3 upload. Configure remote retention on the bucket. Alternatively, send a JSON string as `value` to `PUT /api/settings/backup.s3`; credentials are encrypted in SQLite and Get only reports configuration presence. The environment-configured file takes precedence. Settings changes apply to the next upload.

Example S3 configuration in a mode 0600 file; these values are never returned through the API:

```json
{"endpoint":"https://s3.example.com","region":"us-east-1","bucket":"nelcota-backups","prefix":"production","access_key":"...","secret_key":"..."}
```

Only path-style `PutObject`, HTTPS, signed payloads, and optional session tokens are supported. Redirects are rejected. The signer is checked against the [official AWS Signature V4 vector](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html); TLS uploads, errors, and redirects are tested locally. Acceptance with real R2/Backblaze/MinIO credentials remains external.

## Signed updates and uninstall

`nelcota-panel update v1.2.3` and `nelcota-agent update v1.2.3` submit daemon requests. The panel uses the same coordinated queue as the API; the agent reserves maintenance with the panel over mTLS before requesting the helper. Both wait for active builds. Installers create root-owned `/etc/nelcota-release-{panel,agent}.json` containing the base URL, Minisign key, and architecture. Installation URLs end in an immutable version, such as `https://releases.example.com/v1.2.3`.

The helper accepts only stable versions newer than the installed one, validates the [Minisign](https://jedisct1.github.io/minisign/) prehashed ED format and signed comment, and checks metadata/executable hashes. Services cannot supply helper paths or commands. For a custom panel port, configure `health_url` in the root trust file, such as `http://127.0.0.1:9090/healthz`. Only HTTP on a loopback IP, an explicit port, and `/healthz` are accepted. The default is 127.0.0.1:8080.

The new executable is written and synced beside the installed one, then renamed into place. A `.previous` copy supports automatic rollback if the service does not remain active or installed-version persistence fails; the panel must also pass its local healthcheck. The expected version is bound to the validated release and does not reread a mutable request during restart. The agent must report ready with the current PID/version before helper confirmation. The queue advances only after confirmation and readiness. Applied-version state is protected in `/var/lib/nelcota-updater/`. A power failure leaves a complete executable and previous copy for repair. Helpers do not update Docker, Caddy, or BuildKit, which have separate distribution lifecycles.

`POST /api/operations/update` with `{"version":"v1.2.3"}` validates the release before creating a durable queue, waits for active deploys, updates agents in order, and waits for new-version heartbeats. The panel updates last. A failure stops the batch. An offline server leaves it waiting; queued batches can be cancelled before execution. New builds at a target wait while its update runs. `GET /api/operations` returns states and public error codes; `POST /api/operations/{batch}/cancel` cancels queued stages.

`POST /api/operations/backup` also creates a durable job. Maintenance mutations require an administrator interactively reauthenticated within five minutes. API tokens cannot request backup, update, or cancellation. Manual snapshots remain until administrative removal; seven-day retention applies to daily backups.

Package without publishing:

```bash
scripts/release.sh v1.2.3 MINISIGN_KEY BUILDKITD_AMD64 BUILDKITD_ARM64
```

This requires a clean checkout, creates `dist/v1.2.3/`, and refuses existing versions. It embeds versions and includes `release.json`, `build-info.json` with commit/toolchain/BuildKit hashes, and signed checksums. Production signing identity and release distribution still need configuration. See [staging releases](staging-releases.md) for local test packages.

`scripts/buildkit-staging.sh NEW_DIRECTORY` rebuilds the pinned BuildKit v0.34.0 commit using Go 1.26.9 and corrected dependencies, identifies it as `v0.34.0-nelcota-hml.1`, and requires source vulnerability analysis. This is a Nelcota staging build. Pass its directory as the optional fifth argument to `release.sh` to include provenance, patch, and license in the signed manifest. Module inventories for both daemons are also signed in `buildkit-build-info.txt`.

`nelcota-panel uninstall` / `nelcota-agent uninstall` require root, stop and remove Nelcota services/executables, and preserve data. `--purge` also removes default data, key, and updater-state directories. Docker, Caddy, WireGuard, firewall, SSH hardening, and application containers remain for explicit migration or removal. Shared host resources are preserved.

## TOTP recovery

Enabling TOTP revokes previous sessions, API tokens, and challenges. Sign in again with passkey and TOTP. After configuration, `POST /api/auth/recovery-codes` from a recent interactive session generates ten random 160-bit codes shown only once. The database stores hashes; regeneration invalidates all previous codes. If the authenticator is lost, finish the passkey ceremony and submit its second-factor challenge plus one code to `POST /api/auth/recovery/verify`. Each code is atomically consumed once, including under concurrency.

`POST /api/auth/totp/reset` requires recent interactive authentication and revokes the user's TOTP, codes, challenges, sessions, and API tokens. Passkeys remain; sign in and configure a new second factor. Challenge consumption, credential verification, and session creation are transactional, preventing concurrent counter reuse or session issuance after an interleaved reset.

For local recovery without codes, stop the panel and run `nelcota-panel reset-totp --email user@example.com` with private-directory access. This is audited and uses the same maintenance lock. For installations without a backup key, `nelcota-panel backup-keygen --output /separate-location/backup.key` creates one without overwriting or printing it. Configure `NELCOTA_BACKUP_KEY_FILE` in the service.

## Jobs and diagnostics

`PATCH /api/servers/{id}/limits` accepts `build_limit` (1–8) and `cache_bytes` (64 MiB–100 GiB). Changes are audited and delivered in the periodic snapshot without interrupting active builds. Cache limits apply at the next GC; Prune supports immediate cleanup. Servers include `version` and `ready`; new claims wait for readiness after reconnect.

Agent container metrics include CPU deltas, memory excluding inactive cache, memory limits, network, and PIDs. Collection has a ten-second budget, four concurrent calls, and a maximum of 256 containers per sample; it does not block heartbeat. Disk metrics use the agent's actual data directory.

The official Dockerfile parser records base images with default ARGs and ignores local stages, scratch, and digest pins. A weekly job resolves tags and materializes layers in the BuildKit content store, not Docker's separate cache. It has a timeout and hourly failure retries. Builds also request refreshed resolution; existing applications are not redeployed by the job.

With private diagnostics enabled, deployments exceeding two minutes automatically produce a trace. This is limited to one per hour with five private files retained in `data-dir/traces`. Without diagnostics, the flight recorder and its buffer remain inactive. Manual snapshots remain available on the diagnostics interface.

Agent enrollment accepts invitations only through a mode 0600 file (`--join-file` in the installer, `--join-token-file` in the executable), never process arguments.

Private keys, invitations, S3 credentials, and persisted certificates must be regular files with no symlinks or group/other permissions. Reads validate opened descriptors, enforce size limits, and do not block on FIFOs. Maintenance locks also reject hard links. Enrollment rejects WireGuard public keys already used by the panel or another agent. Initial cache limits use the same 64 MiB minimum as the limits API.
