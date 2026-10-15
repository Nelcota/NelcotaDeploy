#!/usr/bin/env bash
# Empacota sem publicar. Os buildkitd devem ter origem e hash revisados pelo mantenedor.
set -euo pipefail
umask 077
[[ $# == 4 ]] || { printf '%s\n' 'release.sh VERSION MINISIGN_SECRET_KEY_FILE BUILDKITD_AMD64 BUILDKITD_ARM64' >&2; exit 1; }
version=$1 key_file=$2 builder_amd64=$3 builder_arm64=$4
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || exit 1
[[ -f $key_file && -x $builder_amd64 && -x $builder_arm64 ]] || exit 1
command -v minisign >/dev/null
cd "$(dirname "$0")/.."
mkdir -p dist
for component in panel agent; do
 for target in amd64_v1 amd64_v3 arm64; do
  arch=${target%%_*} level=${target#*_}
  [[ $arch != arm64 ]] || level=v1
  GOOS=linux GOARCH="$arch" GOAMD64="$level" CGO_ENABLED=0 go build -trimpath -pgo=auto -ldflags="-s -w -X github.com/nelcota/nelcota-deploy/internal/updater.Version=$version" -o "dist/nelcota-${component}_linux_${target}" "./cmd/nelcota-$component"
 done
done
install -m 0755 "$builder_amd64" dist/buildkitd_linux_amd64
install -m 0755 "$builder_arm64" dist/buildkitd_linux_arm64
printf '{"version":"%s","protocol":1}\n' "$version" > dist/release.json
(cd dist; sha256sum nelcota-* buildkitd_* release.json > checksums.txt)
minisign -Sm dist/checksums.txt -s "$key_file"
printf '%s\n' 'Artefatos locais em dist/. Revise antes de publicar em uma URL HTTPS imutável de release.'
