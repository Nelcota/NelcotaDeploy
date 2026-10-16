# Outstanding work and external acceptance

## Local implementation completed on October 15, 2026

- Profiled memory: one-time release of SQLite compiler and agent startup scratch space; agent GOGC=50 with override support; THP disabled only for service processes.
- Daily/manual backups, consistent WAL snapshots, independent encryption, local/S3 retention, and offline restore with locking, authentication, master-key validation, and interruption recovery.
- Signed CLI/API updates, fixed systemd helper, durable one-agent-at-a-time queue with panel last, readiness/confirmation checks, and executable rollback; uninstall preserves data by default.
- Automatic service certificate renewal, fingerprint grace/retry, and restoration of WireGuard peers from the database.
- Recovery codes and TOTP reset, API-configurable limits/cache, container metrics, weekly BuildKit base-image refresh, and automatic slow-deploy traces when diagnostics are enabled.

Commands, formats, configuration, and boundaries are covered in [operations](backend-operations.md). New API routes are included in the [frontend contract](frontend-contract.md). The items above have no outstanding local implementation work.

## Acceptance requiring infrastructure or credentials

- Install, update/rollback, and reboot disposable Debian/Ubuntu VPS instances with real systemd, IPv4/IPv6 firewall, WireGuard, cgroups, and SSH. Installer syntax and helper logic were tested locally; the workstation was not subjected to root installation.
- Configure the production domain and signing identity, publish official signed releases, and distribute the public key. Source is public at [Nelcota/NelcotaDeploy](https://github.com/Nelcota/NelcotaDeploy); MIT licensing is selected. Local staging binaries have not been published as official releases.
- Configure a real GitHub App, public webhook, and production S3 credentials. GitHub API tests use simulated transport. S3 tests include real local TLS, redirect rejection, and an official SigV4 vector. Go signature verification was checked against official Minisign output on Debian.
- Validate passkeys on real browsers/devices; tests use a virtual ECDSA authenticator.
- Prove all performance targets on representative VPS infrastructure with Go/Node builds, long load, streaming, crashes, full disks, and reboots. Local Docker/BuildKit/Caddy tests passed under traffic. Local memory measurements are documented; they do not establish VPS acceptance.
- Exercise full recovery on a new VPS, including restoring WireGuard with the protected backup key and adjusting domains, addresses, and file owners.

## Later phases

Previews, external notifications, scale-to-zero, Trivy, and Litestream remain in phase 2. PGO stays automatic without an artificial profile; collect representative production data before committing `default.pgo`. The internal five-year CA needs trust migration/renewal before expiration. Automatic rotation covers three-month service certificates.

The recorded govulncheck v1.9.0 scan found no vulnerabilities in called symbols or imported packages. One required-module warning remains for unimported OpenPGP (GO-2026-5932). Keep scanning in CI and inspect distributed daemon versions separately.
