#!/usr/bin/env bash
# Empacota sem publicar. Os buildkitd devem ter origem e hash revisados pelo mantenedor.
set -euo pipefail
umask 077
[[ $# == 4 ]] || { printf '%s\n' 'release.sh VERSION MINISIGN_SECRET_KEY_FILE BUILDKITD_AMD64 BUILDKITD_ARM64' >&2; exit 1; }
version=$1 key_file=$2 builder_amd64=$3 builder_arm64=$4
[[ $version =~ ^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ ]] || exit 1
[[ -f $key_file && -x $builder_amd64 && -x $builder_arm64 ]] || exit 1
command -v minisign >/dev/null
key_file=$(realpath "$key_file")
builder_amd64=$(realpath "$builder_amd64")
builder_arm64=$(realpath "$builder_arm64")
cd "$(dirname "$0")/.."
[[ -z $(git status --porcelain --untracked-files=normal) ]] || { printf '%s\n' 'O código deve estar commitado e limpo antes de empacotar.' >&2; exit 1; }
[[ ! -e dist/$version && ! -L dist/$version ]] || { printf '%s\n' "Release dist/$version já existe; recusando sobrescrever." >&2; exit 1; }
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
  GOOS=linux GOARCH="$arch" GOAMD64="$level" CGO_ENABLED=0 go build -trimpath -pgo=auto -ldflags="-s -w -X github.com/nelcota/nelcota-deploy/internal/updater.Version=$version" -o "$stage/nelcota-${component}_linux_${target}" "./cmd/nelcota-$component"
 done
done
install -m 0755 "$builder_amd64" "$stage/buildkitd_linux_amd64"
install -m 0755 "$builder_arm64" "$stage/buildkitd_linux_arm64"
printf '{"version":"%s","protocol":1}\n' "$version" > "$stage/release.json"
amd64_hash=$(sha256sum "$stage/buildkitd_linux_amd64"); amd64_hash=${amd64_hash%% *}
arm64_hash=$(sha256sum "$stage/buildkitd_linux_arm64"); arm64_hash=${arm64_hash%% *}
printf '{"version":"%s","source_commit":"%s","source_epoch":%s,"go_version":"%s","buildkitd_sha256":{"amd64":"%s","arm64":"%s"}}\n' \
 "$version" "$source_commit" "$source_epoch" "$go_version" "$amd64_hash" "$arm64_hash" > "$stage/build-info.json"
(
 cd "$stage"
 sha256sum nelcota-panel_linux_{amd64_v1,amd64_v3,arm64} nelcota-agent_linux_{amd64_v1,amd64_v3,arm64} buildkitd_linux_{amd64,arm64} release.json build-info.json > checksums.txt
)
minisign -Sm "$stage/checksums.txt" -s "$key_file" -t "Nelcota Deploy $version; source $source_commit"
chmod 0755 "$stage" "$stage"/nelcota-* "$stage"/buildkitd_*
chmod 0644 "$stage"/*.json "$stage"/checksums.txt "$stage"/checksums.txt.minisig
mv -T --no-clobber "$stage" "dist/$version"
[[ ! -d $stage ]] || { printf '%s\n' 'Destino ocupado durante o empacotamento.' >&2; exit 1; }
printf 'Release assinado local: dist/%s/\n' "$version"
