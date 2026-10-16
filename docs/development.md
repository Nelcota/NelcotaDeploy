# Development and release automation

This page describes the GitHub workflows, Makefile targets, and scripts that build, check, sign, and publish NelcotaDeploy, plus what each one needs. **None of the new workflows has run on GitHub yet.** The [status table](#verification-status) says what was checked locally and what still needs Docker, a Hetzner token, signing secrets, or GitHub itself.

## Makefile targets

| Target | What it does | Needs |
| --- | --- | --- |
| `make build test lint` | Build both executables, run unit tests (including the English-only check), vet, golangci-lint, ShellCheck | Go 1.26.9, `make tools` |
| `make english` | Only the English-only check (`go test ./internal/policy/`) | Go, Git |
| `make lint-workflows` | actionlint v1.7.12 on `.github/workflows` (also runs ShellCheck on `run:` steps) | `make tools` |
| `make test-integration` | Integration tests; fails first with a clear message when the Docker daemon or Caddy is missing | Docker daemon, Caddy (`caddy` on PATH or `CADDY_BIN`) |
| `make e2e` | Playwright browser tests against `nelcota-panel dev` on the host | Node, `cd web && npm ci && npx playwright install chromium` |
| `make visual` | Visual regression of the component gallery inside the pinned Playwright container | Docker |
| `make visual-update` | Regenerate the container baselines; review and commit the PNG files | Docker |
| `make screenshots` | Regenerate `docs/screenshots` inside the pinned Playwright container | Docker |
| `make report-numbers` | Rewrite the generated numbers block in `docs/frontend-report.md` | Go; Node and Playwright browsers on the host |

Missing infrastructure is never a passing result ([AGENTS.md](../AGENTS.md)): `make test-integration`, `make visual`, and `make screenshots` stop with an error instead of skipping.

## Workflows

| Workflow | Trigger | Permissions | Secrets and variables |
| --- | --- | --- | --- |
| `ci.yml` (Backend) | push to `main`, pull requests, manual, and `workflow_call` from `release.yml` | `contents: read` | none |
| `release.yml` | `v*` tags; manual run on a tag | `contents: read`; `id-token: write` on `package`; `contents: write` only on `publish` | `release` environment (below) |
| `vps-acceptance.yml` | manual; weekly schedule only when the variable `VPS_ACCEPTANCE_SCHEDULE` is `true` | `contents: read` | `vps-acceptance` environment (below) |
| `vendor-refresh.yml` | weekly (Monday 07:00 UTC) and manual | `contents: write`, `pull-requests: write` on its only job | `GITHUB_TOKEN` |
| `screenshots.yml` | weekly (Monday 08:00 UTC) and manual | `contents: write`, `pull-requests: write` on its only job | `GITHUB_TOKEN` |

All actions are pinned to commit SHAs like the existing CI. Every job has a timeout and every workflow a concurrency group; release and VPS runs are never cancelled midway. Dependabot updates Go modules, GitHub Actions, and the npm packages in `web/` weekly.

Pull requests opened by `vendor-refresh.yml` and `screenshots.yml` use `GITHUB_TOKEN`, so GitHub does not start other workflows on them. Close and reopen the pull request, or push to its branch, to run CI before merging.

### CI additions

- **English-only content** runs `make english` (it is also part of `make test`).
- **Visual regression** runs `make visual`. When it fails, the rendered images are uploaded as the `visual-actual` artifact and the log says whether baselines are missing or differ.
- **Validation** also runs `make lint-workflows`.

## Releases

`release.yml` does the following for a stable `vMAJOR.MINOR.PATCH` tag:

1. `prepare` rejects anything that is not a stable tag. Pre-release tags such as `v1.2.0-rc.1` fail because `scripts/release.sh` and the updater accept only stable versions. For a manual run, choose the tag under *Use workflow from*; the run creates a draft by default.
2. `checks` runs all of `ci.yml` on the tag: generation, build, tests, lint, govulncheck, browser tests, visual regression, race detector, integration tests, and benchmarks.
3. `package` (environment `release`) rebuilds BuildKit with `scripts/buildkit-staging.sh`, writes the Minisign key to a mode 0600 file under `$RUNNER_TEMP`, runs `scripts/release.sh`, deletes the key in an `always()` step, verifies the signature against `MINISIGN_PUBLIC_KEY` and every SHA-256, adds a keyless Sigstore bundle (`checksums.txt.sigstore.json`), and writes release notes with `scripts/release-notes.sh`. The notes list the commits since the previous `v*` tag.
4. `publish` downloads the artifact, verifies the signature and hashes again, and runs `gh release create --verify-tag`. This step refuses to replace an existing release, so published versions stay immutable.
5. `mirror` runs only when `RELEASE_MIRROR_DESTINATION` is set. It publishes the same files to the direct HTTPS mirror with `scripts/release-mirror.sh`.

The BuildKit recipe is still the identified staging rebuild (`v0.34.0-nelcota-hml.1`). Choosing a production BuildKit recipe and signing identity is a maintainer decision ([outstanding work](outstanding-work.md)).

### `release` environment

Create the environment under *Settings → Environments* and add required reviewers so a tag alone cannot sign.

| Name | Kind | Value |
| --- | --- | --- |
| `MINISIGN_SECRET_KEY` | secret | Full contents of the Minisign secret key file (both lines) |
| `MINISIGN_PASSWORD` | secret, optional | The key's password. Leave it unset for a key made with `minisign -G -W` |
| `MINISIGN_PUBLIC_KEY` | variable | The public key (second line of `minisign.pub`), also used by the VPS workflow |
| `RELEASE_MIRROR_DESTINATION` | variable, optional | `user@host:/var/www/nelcota-releases`, the release URL root on the mirror |
| `RELEASE_MIRROR_SSH_KEY` | secret, required with a mirror | Private SSH key that can write the destination directory |
| `RELEASE_MIRROR_KNOWN_HOSTS` | variable, required with a mirror | `known_hosts` lines for the mirror; host keys are checked strictly |

To sign without a prompt, `scripts/release.sh` reads the key password from the file named by `MINISIGN_PASSWORD_FILE`. Without that variable it prompts as before, so local use does not change. Secrets reach the runner only as files under `$RUNNER_TEMP` and are never printed.

### Release URL layout and `latest`

Installers take an immutable URL ending in the version. The signed updater and the panel's version check use its parent, the **release URL root**:

```text
<release_url>/latest              newest stable tag and a newline, e.g. "v1.4.2\n" (at most 64 bytes)
<release_url>/<version>/<file>    every file from dist/<version>/, e.g. <release_url>/v1.4.2/checksums.txt
```

For example, `--release-url https://releases.example.com/nelcota/v1.4.2` gives the root `https://releases.example.com/nelcota`. The panel reads `https://releases.example.com/nelcota/latest` and then verifies `https://releases.example.com/nelcota/v1.4.2/checksums.txt` and its `.minisig` before offering or applying that version.

`latest` is an unsigned hint, and nothing signs it. `scripts/release-mirror.sh` uploads a version into `.incoming-<version>`, checks the hashes on the destination, and renames the directory into place. It refuses existing versions. It then replaces `latest` atomically, and only when the new version sorts higher (`sort -V`), so a patch to an older line never moves `latest` backwards. Pre-release tags (containing `-`) never update `latest`. The script verifies the Minisign signature and every hash before uploading. It also works with a local directory as the destination:

```bash
MINISIGN_PUBLIC_KEY=RW... scripts/release-mirror.sh dist/v1.4.2 /var/www/nelcota-releases
MINISIGN_PUBLIC_KEY=RW... RELEASE_MIRROR_SSH_OPTS='-i ~/.ssh/release' \
  scripts/release-mirror.sh dist/v1.4.2 publisher@release-host:/var/www/nelcota-releases
```

The GitHub release carries the same files plus `latest` and the Sigstore bundle. **GitHub release downloads redirect** to a storage host, and the updater rejects redirects. Installers follow redirects, so `--release-url https://github.com/Nelcota/NelcotaDeploy/releases/download/v1.4.2` works for a first installation, but in-panel update checks and updates need the direct mirror.

## Disposable VPS acceptance

`scripts/vps-acceptance.sh` puts the steps from [VPS acceptance](vps-testing.md) that can run without a person into code. `vps-acceptance.yml` runs it, and you can also run it locally:

```bash
export HCLOUD_TOKEN=...   # read by hcloud; never printed
scripts/vps-acceptance.sh run --release-url https://releases.example.com/nelcota/v1.4.2 \
  --signing-key "$MINISIGN_PUBLIC_KEY" --output-dir ./acceptance-logs
scripts/vps-acceptance.sh cleanup --run-id local-1a2b3c4d   # after an interrupted run
```

The script:

1. Checks the release's signed manifest and `release.json` from the runner before creating anything.
2. Creates an ephemeral ed25519 key and Debian 12 servers. Every resource carries the label `nelcota-acceptance=<run id>`.
3. Uploads `scripts/install.sh` and runs it as documented. The domain is `<ip-with-dashes>.sslip.io`, so Caddy can get a public certificate without DNS setup.
4. Checks the panel version, active and enabled units, the `inet nelcota` firewall table, loopback `/healthz`, public HTTPS `/healthz` with a valid certificate, the mode of `first-access.json`, and that port 8080 is closed from the internet.
5. On a second server, runs `scripts/agent.sh` with an invitation the panel never issued. This verifies the signed agent and BuildKit downloads, Docker from the pinned repository, and that the panel **rejects** the unknown invitation. The run does not register a real agent: invitations need a passkey-authenticated session, so registration stays a manual step in the VPS guide.
6. Reboots the panel (the boot ID must change) and repeats the panel checks.
7. Always deletes the servers and the key through an `EXIT` trap. The workflow repeats this in an `if: always()` step and fails if anything labeled with the run ID remains.

The workflow installs hcloud v1.70.1 with a pinned SHA-256. It reads `HCLOUD_TOKEN` (secret), `MINISIGN_PUBLIC_KEY`, and optionally `VPS_ACCEPTANCE_RELEASE_URL` and `VPS_ACCEPTANCE_SCHEDULE` (variables) from the `vps-acceptance` environment. The defaults `fsn1` and `cx23` are inputs; check them against the current Hetzner offer.

**Unverified:** the script has passed ShellCheck, `bash -n`, and dry runs with stubbed `hcloud`, `ssh`, `scp`, `curl`, and `minisign`, covering both a passing run and a failing one, each of which cleaned up. It has not run against Hetzner Cloud. Its first real run is part of VPS acceptance, and its results do not replace the manual stages in [VPS acceptance](vps-testing.md).

## Visual regression and screenshots

`scripts/playwright-container.sh` runs a command in `web/` inside `mcr.microsoft.com/playwright:v<version>-noble`. The version is read from the exact `@playwright/test` pin in `web/package.json`, and Dependabot bumps the image together with the package. The host-built `bin/nelcota-panel` is static, so it runs unchanged in the container. `npm ci` runs only when `node_modules` does not hold the pinned version.

- `make visual` uses `web/playwright.visual.config.js`, which stores baselines in `web/e2e/visual.spec.js-snapshots/container/` and never writes missing ones. **No container baselines exist yet**, because Docker was not available when this was set up. Until someone runs `make build visual-update` on a machine with Docker and commits the two PNG files, the CI job fails, says that baselines are missing, and uploads the rendered images.
- The host baselines in `web/e2e/visual.spec.js-snapshots/` (`gallery-*-linux.png`) still serve the local `VISUAL=1 npx playwright test e2e/visual.spec.js` path, so they were kept. Delete them only if that path is retired.
- `make screenshots` runs `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.js` in the same container. The first container run will change every image, because fonts differ from the workstation that made the current set.

## Measured numbers in the frontend report

`make report-numbers` runs `go test -v -run 'TestAssetBudget|TestPageScriptBudget' ./web/...` and the Playwright suite with the JSON reporter. It replaces only the lines between `<!-- generated:numbers:start -->` and `<!-- generated:numbers:end -->` in [the frontend report](frontend-report.md). It refuses to write when a budget test or browser test fails. `--playwright-json FILE` reuses an existing report, and `--skip-playwright` measures only the asset sizes.

## English-only check

`internal/policy` walks `git ls-files --cached --others --exclude-standard` and fails on Portuguese outside `web/i18n/pt_br.go`. It looks for the accented letters Portuguese uses (the `portugueseLetters` constant) and for a short list of common Portuguese words, matched as whole words after splitting identifiers on non-letters. It also checks path names. Vendored, generated, binary, image, font, and lock files and `docs/screenshots` are skipped. The test fails if Git is unavailable. Exceptions for proper names and immutable identifiers go in the commented `allowed` list in `internal/policy/english_test.go`; an entry that no longer matches anything fails the test. Empty directories are invisible to Git and are not checked.

## Verification status

| Item | Checked locally | Still unverified |
| --- | --- | --- |
| Workflows | actionlint v1.7.12 (with ShellCheck), PyYAML parse | Never run on GitHub |
| `release.sh` password file | Signed a scratch release with a password-protected key and no TTY; Minisign and SHA-256 verified | CI run with real secrets |
| `release-mirror.sh` | Local and stubbed-SSH destinations: version ordering, pre-release, overwrite refusal, tampered file, unlisted file, wrong key | A real mirror host |
| `release-notes.sh` | Scratch repository with and without a previous tag | — |
| `vps-acceptance.sh` | ShellCheck, `bash -n`, stubbed pass and failure runs with cleanup | Hetzner Cloud, sslip.io certificates, reboot timing |
| `make visual`, `make screenshots` | ShellCheck; clear failure without Docker | Container run; baselines not generated |
| `make test-integration` preflight | Fails with clear messages without Docker or Caddy | — (CI installs both, unchanged) |
| `make report-numbers` | Clean copy: asset and page budgets parsed into the block; the Playwright path refused to write because one browser test failed (43 pass, 10 skipped, 1 failed) | A full write, after the browser suite passes; the block in the report is empty until then |
| English-only check | `go test ./internal/policy/`, golangci-lint | — |
