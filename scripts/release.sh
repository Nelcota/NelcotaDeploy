#!/usr/bin/env bash
# Package without publishing. The maintainer must review BuildKit provenance and hashes.
# Set MINISIGN_PASSWORD_FILE to sign without a prompt (used by .github/workflows/release.yml).
set -euo pipefail
umask 077
[[ $# == 4 || $# == 5 ]] || { printf '%s\n' 'release.sh VERSION MINISIGN_SECRET_KEY_FILE BUILDKITD_AMD64 BUILDKITD_ARM64 [BUILDKIT_PROVENANCE_DIR]' >&2; exit 1; }
version=$1 key_file=$2 builder_amd64=$3 builder_arm64=$4
provenance=${5:-}
[[ $version =~ ^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ ]] || exit 1
[[ -f $key_file && -x $builder_amd64 && -x $builder_arm64 ]] || exit 1
command -v minisign >/dev/null
key_file=$(realpath "$key_file")
builder_amd64=$(realpath "$builder_amd64")
builder_arm64=$(realpath "$builder_arm64")
if [[ -n $provenance ]]; then
 provenance=$(realpath "$provenance")
 for name in buildkit-provenance.json buildkit-security.patch buildkit-LICENSE.txt; do
  [[ -f $provenance/$name && ! -L $provenance/$name ]] || exit 1
 done
fi
cd "$(dirname "$0")/.."
[[ -z $(git status --porcelain --untracked-files=normal) ]] || { printf '%s\n' 'Commit the code and clean the working tree before packaging.' >&2; exit 1; }
[[ ! -e dist/$version && ! -L dist/$version ]] || { printf '%s\n' "Release dist/$version already exists; refusing to overwrite." >&2; exit 1; }
mkdir -p dist
stage=$(mktemp -d "dist/.${version}.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
source_commit=$(git rev-parse HEAD)
source_epoch=$(git show -s --format=%ct HEAD)
go_version=$(go env GOVERSION)
[[ $go_version =~ ^go[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || exit 1
for component in panel agent; do
 for target in amd64_v1 amd64_v3 arm64; do
  arch=${target%%_*} level=${target#*_}
  [[ $arch != arm64 ]] || level=v1
  GOOS=linux GOARCH="$arch" GOAMD64="$level" CGO_ENABLED=0 go build -trimpath -pgo=auto -ldflags="-s -w -X github.com/Nelcota/NelcotaDeploy/internal/updater.Version=$version" -o "$stage/nelcota-${component}_linux_${target}" "./cmd/nelcota-$component"
 done
done
install -m 0755 "$builder_amd64" "$stage/buildkitd_linux_amd64"
install -m 0755 "$builder_arm64" "$stage/buildkitd_linux_arm64"
printf '{"version":"%s","protocol":1}\n' "$version" > "$stage/release.json"
amd64_hash=$(sha256sum "$stage/buildkitd_linux_amd64"); amd64_hash=${amd64_hash%% *}
arm64_hash=$(sha256sum "$stage/buildkitd_linux_arm64"); arm64_hash=${arm64_hash%% *}
printf '{"version":"%s","source_commit":"%s","source_epoch":%s,"go_version":"%s","buildkitd_sha256":{"amd64":"%s","arm64":"%s"}}\n' \
 "$version" "$source_commit" "$source_epoch" "$go_version" "$amd64_hash" "$arm64_hash" > "$stage/build-info.json"
extras=()
if [[ -n $provenance ]]; then
 extras=(buildkit-provenance.json buildkit-security.patch buildkit-LICENSE.txt)
 for name in "${extras[@]}"; do install -m 0644 "$provenance/$name" "$stage/$name"; done
fi
(
 cd "$stage"
 go version -m buildkitd_linux_amd64 buildkitd_linux_arm64 > buildkit-build-info.txt
 sha256sum nelcota-panel_linux_{amd64_v1,amd64_v3,arm64} nelcota-agent_linux_{amd64_v1,amd64_v3,arm64} buildkitd_linux_{amd64,arm64} release.json build-info.json buildkit-build-info.txt "${extras[@]}" > checksums.txt
)
sign=(minisign -Sm "$stage/checksums.txt" -s "$key_file" -t "NelcotaDeploy $version; source $source_commit")
# Non-interactive signing (CI): MINISIGN_PASSWORD_FILE holds the key password; otherwise minisign prompts.
if [[ -n ${MINISIGN_PASSWORD_FILE:-} ]]; then
 [[ -f $MINISIGN_PASSWORD_FILE && ! -L $MINISIGN_PASSWORD_FILE ]] || { printf '%s\n' 'MINISIGN_PASSWORD_FILE must be a regular file.' >&2; exit 1; }
 "${sign[@]}" < "$MINISIGN_PASSWORD_FILE"
else
 "${sign[@]}"
fi
chmod 0755 "$stage" "$stage"/nelcota-* "$stage"/buildkitd_*
chmod 0644 "$stage"/*.json "$stage"/*.txt "$stage"/checksums.txt.minisig
mv -T --no-clobber "$stage" "dist/$version"
[[ ! -d $stage ]] || { printf '%s\n' 'Destination became occupied during packaging.' >&2; exit 1; }
printf 'Locally signed release: dist/%s/\n' "$version"
