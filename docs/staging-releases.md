# Local staging releases

**v1.0.0, v1.0.1, and v1.0.2** were prepared locally in `dist/` (ignored by Git) on October 15, 2026, signed with a laboratory Minisign key, and used to test updates and rollback. They are not published and are not official releases.

All three use original source commit `dba1c3ba0a7cdebd50ba76d9cd4eab5ddcd5ee15`, Go 1.26.9, disabled CGO, and a clean checkout. Their only intended difference is the executable version number, enabling update/rollback sequence testing. The signing identity is specific to local staging. When the Git history was normalized to English, that commit became `af240f88907523120f0fb7d6f7884b34bc232f67` (same file tree). Signed commit IDs, filenames, hashes, and signatures remain unchanged.

## Artifacts

| Local file | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/nelcota-deploy-v1.0.0-linux.tar.gz` | 81,283,948 | `4298f442a33401e1493da93c973ef6f0066ca04267bfd021c580be4eb5273d04` |
| `dist/nelcota-deploy-v1.0.1-linux.tar.gz` | 81,284,044 | `bd4470efefcca492279c0c7ca87d9c3f739d652eb934ff2b6615904ec956852c` |
| `dist/nelcota-deploy-v1.0.2-linux.tar.gz` | 81,283,929 | `6509950273289d498ef0211553da0554af51b774db76e7ce87372aa4bd589aa7` |

Each archive has a `.tar.gz.minisig` signature. Extracted `dist/v1.0.0/`, `dist/v1.0.1/`, and `dist/v1.0.2/` directories use installer/updater filenames. Each contains exactly 16 files:

- Six panel/agent executables for linux_amd64_v1, linux_amd64_v3, and linux_arm64.
- Two BuildKit daemons, amd64 and arm64.
- release.json, build-info.json, buildkit-build-info.txt, buildkit-provenance.json, buildkit-security.patch, and buildkit-LICENSE.txt.
- checksums.txt and checksums.txt.minisig, covering all 14 payload files.

`dist/evidencias-homologacao.tar.gz` preserves logs, validators, and upstream provenance. `dist/VALIDACAO.md` is the original signed-delivery report, retained unchanged; this English document describes the same delivery. Signed `dist/SHA256SUMS` covers archives, signatures, public key, original report, and evidence. Historical artifact paths are identifiers, not current project naming conventions.

## Signing identity

Public key in `dist/homologacao.minisign.pub`:

```text
RWTogK7s/y7BIqc7dw0qfzxK9pNTCSGUyYHc0/K3heUXXWK90ulX52K6
```

- Minisign ID: `22C12EFFECAE80E8`.
- Public-key file SHA-256: `8463daf3dc1a4b959ea81ad69ebe98cdde64bc93aa07be8ee818caad65bb39a6`.
- Private key: `~/.config/nelcota-release-homologacao/minisign.key` on the maintainer's workstation, outside the repository and packages; directory mode 0700, key mode 0600.
- The laboratory key was generated without a password for autonomous local signing. Protection relies on these local permissions. Preserve it for subsequent laboratory releases; production identity is a separate decision.

Verify the public key through a trusted channel before moving packages. Do not trust only a key downloaded beside the package.

## Corrected BuildKit rebuild

The [official v0.34.0 release](https://github.com/moby/buildkit/releases/tag/v0.34.0) was downloaded and verified through SHA-256 and Sigstore provenance using `gh attestation verify`. Policy checked repository, tag, source commit, signing workflow/digest, and GitHub-hosted runner.

| Upstream archive | SHA-256 |
| --- | --- |
| buildkit-v0.34.0.linux-amd64.tar.gz | `14813b1fb2a40082114e6d386c6fc5e7dd5298176ce7ee1a18bc33e73e109ac3` |
| buildkit-v0.34.0.linux-arm64.tar.gz | `0619ca3e3205a32ea2beb115e0242136e4a0716cc1917ba0ceaa4ef4d52382c9` |

Original binaries produced 12 version alerts: Go 1.26.8, x/net 0.59.0, and go-archive 0.2.0 predated fixes for HTTP/2 and tar extraction. References include [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) and [GO-2026-6253](https://pkg.go.dev/vuln/GO-2026-6253). Complete original alerts remain in the evidence.

Original daemons are excluded from delivery. The attested source commit `f5b59a1f2fb25a0cb7072c398cab9aed7835da4e` was rebuilt locally with:

- Distinct version `v0.34.0-nelcota-hml.1`.
- Go 1.26.9, golang.org/x/net 0.61.0, github.com/moby/go-archive 0.3.0, and recorded transitive updates.
- CGO disabled; tags osusergo,netgo,static_build,seccomp matching upstream build metadata.
- trimpath, buildvcs=false, and explicit source commit/patch in signed provenance. No upstream Go source changes; the patch changes go.mod/go.sum only.

| Final daemon, identical across all three releases | SHA-256 |
| --- | --- |
| buildkitd_linux_amd64 | `4f52e57ee50d7c3d28c3e295a7c53934515210e4c1dbb1f74b073df7bac90dac` |
| buildkitd_linux_arm64 | `1d3d83aaa140e7792f2a16500bca0cdc3c6cf6f09ead5ed57c8a7f1d59053ca4` |

Upstream signatures attest upstream files/origin; rebuilt daemons are identified and signed by the local Nelcota staging identity. Upstream SBOMs describe original binaries. Final inventories are in buildkit-build-info.txt.

## Completed local validation

| Check | Recorded result |
| --- | --- |
| Unit tests, vet, golangci-lint, ShellCheck, generated code | make test lint check-generated passed |
| Signatures/SHA-256 | Go updater and Minisign validated manifests; independent Debian Minisign 0.11 validated packages/manifests signed by 0.12 |
| Package contents | Exactly 16 files per version; no links/extras; paths, modes, and hashes checked |
| Architecture/build | 18 Nelcota binaries and six BuildKit copies checked for static ELF, architecture, CGO, versions, dependencies, metadata |
| amd64 v1/v3 | version ran on 12 Nelcota binaries; amd64 BuildKit ran for all releases |
| Debian/Ubuntu | Version commands ran in local Debian 12/Ubuntu 22.04 containers without network and with read-only files |
| arm64 | version/help for six Nelcota executables and version for three BuildKit copies under QEMU 7.2.22 |
| Real deployment | Final release agents/daemons passed builds, healthchecks, routing, hardening, metrics, swaps under local traffic, and unhealthy-candidate rejection |
| Backup/restore | Each final panel made an API backup, rejected online restore, restored offline, and made another backup |
| Backup compatibility | v1.0.0 restored into v1.0.1/v1.0.2, preserving master key and passing SQLite integrity_check and subsequent backup |
| Update/rollback | Local TLS with real amd64 v1/v3 files: panel/agent v1.0.0→v1.0.1→v1.0.2; readiness failures restored previous bytes/version/state, followed by successful retry |
| Negative updater tests | Altered signatures/manifests/metadata/binaries, wrong keys, redirects, replay, and downgrades rejected |
| Packaging recipe | Existing destinations and unsupported version formats rejected |
| Vulnerabilities | Source amd64/arm64 had no reachable/imported-package findings; all 24 final binaries scanned with the warning below retained |

The remaining [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) alert concerns golang.org/x/crypto/openpgp, which is not imported. With stripped -s -w binaries, govulncheck 1.9.0 may operate at module precision and cannot prove that package is present. See [scanner limitations](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck#hdr-Limitations). Full logs, including the alert, remain preserved.

Integration used a local-only Go overlay selecting release executables and an image containing the delivered BuildKit. The in-image daemon hash matched delivery. Overlay sources are included in evidence; tracked tests were unchanged. arm64 emulation used GOMAXPROCS=1 and GODEBUG=asyncpreemptoff=1 because QEMU 7.2 intermittently stalled with more emulated CPUs. This proves those commands under emulation, not real arm64 deployments.

## Verify without installation

From the project root, with Minisign on PATH (local copy: .tools/minisign):

```bash
set -euo pipefail
export PATH="$PWD/.tools:$PATH"
printf '%s\n' '8463daf3dc1a4b959ea81ad69ebe98cdde64bc93aa07be8ee818caad65bb39a6  dist/homologacao.minisign.pub' | sha256sum -c -
minisign -Vm dist/SHA256SUMS -p dist/homologacao.minisign.pub
(cd dist && sha256sum -c SHA256SUMS)
for version in v1.0.0 v1.0.1 v1.0.2; do
  minisign -Vm "dist/nelcota-deploy-$version-linux.tar.gz" -p dist/homologacao.minisign.pub
  minisign -Vm "dist/$version/checksums.txt" -p dist/homologacao.minisign.pub
  (cd "dist/$version" && sha256sum -c checksums.txt)
done
```

For the [VPS guide](vps-testing.md), use the prepared release directory and trusted public key. Do not regenerate keys or overwrite existing releases. Installers still need a direct HTTPS distribution URL. Panel/agent updates do not replace BuildKit.

## Reproduce a new staging build

In a clean checkout with Go 1.26.9, Minisign, and govulncheck 1.9.0, choose a new output directory and retain the existing laboratory key:

```bash
bash scripts/buildkit-staging.sh .local/buildkit-staging-new
for version in v1.0.0 v1.0.1 v1.0.2; do
  bash scripts/release.sh "$version" \
    "$HOME/.config/nelcota-release-homologacao/minisign.key" \
    "$PWD/.local/buildkit-staging-new/amd64/buildkitd" \
    "$PWD/.local/buildkit-staging-new/arm64/buildkitd" \
    "$PWD/.local/buildkit-staging-new"
done
```

Existing release destinations are rejected. Exact original reproduction requires the mapped historical source tree, not current source, whose module name and English messages have changed. Local validators in .local/release-validation and the evidence archive validate manifests and update/rollback using only loopback TLS. The signed original source identifier remains immutable.

## VPS acceptance

These packages were validated locally only, as listed above. See [status](status.md) for what still needs VPS testing.
