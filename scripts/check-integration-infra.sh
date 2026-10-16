#!/usr/bin/env bash
# Fail early when the infrastructure required by `make test-integration` is missing.
# Integration tests need a reachable Docker daemon (testcontainers) and a Caddy
# binary (CADDY_BIN or PATH). Missing infrastructure is not a passing result.
set -euo pipefail
missing=0
if ! command -v docker >/dev/null 2>&1; then
	printf '%s\n' 'Integration tests need Docker: the docker CLI is not on PATH.' >&2
	missing=1
elif ! docker info >/dev/null 2>&1; then
	printf '%s\n' 'Integration tests need Docker: the daemon is not reachable (start it, check DOCKER_HOST, or join the docker group).' >&2
	missing=1
fi
caddy=${CADDY_BIN:-}
if [[ -n $caddy ]]; then
	[[ -x $caddy ]] || { printf 'Integration tests need Caddy: CADDY_BIN=%s is not an executable file.\n' "$caddy" >&2; missing=1; }
elif ! command -v caddy >/dev/null 2>&1; then
	printf '%s\n' 'Integration tests need Caddy: install it or set CADDY_BIN to its path.' >&2
	missing=1
fi
if ((missing)); then
	printf '%s\n' 'Refusing to run integration tests without real infrastructure; this is not a passing result (see AGENTS.md).' >&2
	exit 1
fi
