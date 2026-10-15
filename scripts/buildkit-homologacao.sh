#!/usr/bin/env bash
# Recompilação local identificada, baseada no commit atestado do BuildKit v0.34.0.
set -euo pipefail
umask 077
[[ $# == 1 ]] || { printf '%s\n' 'buildkit-homologacao.sh DIRETORIO_NOVO' >&2; exit 1; }
[[ $(go env GOVERSION) == go1.26.9 ]] || { printf '%s\n' 'Esta receita de homologação fixa Go 1.26.9.' >&2; exit 1; }
command -v govulncheck >/dev/null
output=$(realpath -m "$1")
[[ ! -e $output && ! -L $output ]] || { printf '%s\n' 'O diretório de saída já existe.' >&2; exit 1; }
mkdir -p "$output"
git clone --depth 1 --branch v0.34.0 https://github.com/moby/buildkit.git "$output/source"
cd "$output/source"
revision=f5b59a1f2fb25a0cb7072c398cab9aed7835da4e
[[ $(git rev-parse HEAD) == "$revision" ]] || { printf '%s\n' 'Commit upstream inesperado.' >&2; exit 1; }
GOFLAGS=-mod=mod go get github.com/moby/go-archive@v0.3.0 golang.org/x/net@v0.61.0
git diff -- go.mod go.sum > "$output/buildkit-security.patch"
install -m 0644 LICENSE "$output/buildkit-LICENSE.txt"
build_tags=osusergo,netgo,static_build,seccomp
for arch in amd64 arm64; do
 mkdir -p "$output/$arch"
 GOFLAGS=-mod=readonly CGO_ENABLED=0 GOOS=linux GOARCH="$arch" GOAMD64=v1 go build -buildvcs=false -trimpath -tags "$build_tags" \
  -ldflags="-s -w -X github.com/moby/buildkit/version.Version=v0.34.0-nelcota-hml.1 -X github.com/moby/buildkit/version.Revision=$revision -X github.com/moby/buildkit/version.Package=github.com/moby/buildkit" \
  -o "$output/$arch/buildkitd" ./cmd/buildkitd
done
GOFLAGS="-mod=readonly -tags=$build_tags" CGO_ENABLED=0 govulncheck -show verbose ./cmd/buildkitd > "$output/vulnerabilities-source.log" 2>&1
patch_hash=$(sha256sum "$output/buildkit-security.patch"); patch_hash=${patch_hash%% *}
printf '{"upstream_repository":"https://github.com/moby/buildkit","upstream_tag":"v0.34.0","upstream_commit":"%s","version":"v0.34.0-nelcota-hml.1","go_version":"go1.26.9","build_tags":"%s","cgo_enabled":false,"buildvcs":false,"security_patch_sha256":"%s","rebuild_identity":"Nelcota homologacao; not an upstream release binary"}\n' \
 "$revision" "$build_tags" "$patch_hash" > "$output/buildkit-provenance.json"
printf 'BuildKit de homologação compilado e analisado em %s\n' "$output"
