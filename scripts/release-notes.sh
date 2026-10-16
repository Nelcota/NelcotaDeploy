#!/usr/bin/env bash
# Print Markdown release notes for TAG: the commits since the previous v* tag
# reachable from TAG, plus verification instructions for the signed manifest.
# Usage: scripts/release-notes.sh TAG [MINISIGN_PUBLIC_KEY]
# Requires full history and tags (actions/checkout with fetch-depth: 0).
set -euo pipefail
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
[[ $# == 1 || $# == 2 ]] || fail 'Usage: scripts/release-notes.sh TAG [MINISIGN_PUBLIC_KEY]'
tag=$1 public_key=${2:-}
[[ $tag =~ ^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ ]] || fail "Release tags look like v1.2.3, not $tag"
cd "$(dirname "$0")/.."
git rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null || fail "Tag $tag does not exist locally; fetch tags first"
previous=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "$tag^" 2>/dev/null || true)
if [[ -n $previous ]]; then
	range="$previous..$tag"
	printf '## Changes since %s\n\n' "$previous"
else
	range=$tag
	printf '## Changes\n\nFirst release; all commits are listed.\n\n'
fi
changes=$(git log --no-merges --reverse --format='- %s (%h)' "$range")
printf '%s\n' "${changes:-- No commits since the previous release.}"
cat <<'EOF'

## Verify before installing

`checksums.txt` lists the SHA-256 of every payload file and is signed with Minisign
(`checksums.txt.minisig`). Obtain the public key through a trusted channel, not only
from this page, then verify:

```bash
minisign -Vm checksums.txt -P "$MINISIGN_PUBLIC_KEY"
sha256sum --check --ignore-missing checksums.txt
```
EOF
if [[ -n $public_key ]]; then
	# shellcheck disable=SC2016 # Backticks are a Markdown code fence.
	printf '\nPublic key published by the maintainers for this release:\n\n```text\n%s\n```\n' "$public_key"
fi
cat <<'EOF'

`checksums.txt.sigstore.json` is an additional keyless Sigstore signature of the same
manifest made by this repository's release workflow. Minisign remains the trust root
used by the installers and the signed updater.

Installers download from an immutable URL ending in the version. GitHub release
downloads redirect, so the in-panel updater, which rejects redirects, needs these
files mirrored on a direct HTTPS host (see docs/development.md).
EOF
