#!/usr/bin/env bash
# Run a command in web/ inside the official Playwright image pinned to the exact
# @playwright/test version in web/package.json. Fonts and browser builds then
# match on every machine, so screenshots are comparable across hosts and CI.
#
# Usage: scripts/playwright-container.sh COMMAND [ARGS...]
# Example: scripts/playwright-container.sh npx playwright test e2e/visual.spec.js
#
# The panel binary must already exist in bin/ (make build); it is a static
# CGO-free executable, so the host build runs unchanged in the container.
# Pass extra environment variables with PLAYWRIGHT_CONTAINER_ENV="NAME1 NAME2".
set -euo pipefail
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
(($#)) || fail 'Usage: scripts/playwright-container.sh COMMAND [ARGS...]'
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(sed -n 's/^ *"@playwright\/test": *"\([^"]*\)".*/\1/p' "$root/web/package.json")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'web/package.json must pin @playwright/test to an exact version'
image=${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v$version-noble}
[[ -x $root/bin/nelcota-panel ]] || fail 'bin/nelcota-panel is missing; run make build first'
command -v docker >/dev/null 2>&1 || fail 'Docker is required: the docker CLI is not on PATH'
docker info >/dev/null 2>&1 || fail 'Docker is required: the daemon is not reachable'
env_args=(-e CI -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e "PLAYWRIGHT_EXPECTED_VERSION=$version")
for name in ${PLAYWRIGHT_CONTAINER_ENV:-}; do
	[[ $name =~ ^[A-Z_][A-Z0-9_]*$ ]] || fail "Invalid variable name in PLAYWRIGHT_CONTAINER_ENV: $name"
	env_args+=(-e "$name")
done
tty_args=()
[[ -t 0 && -t 1 ]] && tty_args=(-t)
# Install dependencies only when node_modules does not already hold the pinned
# version, so a host checkout keeps its existing install.
# shellcheck disable=SC2016 # Expanded by the container shell.
exec docker run --rm --init --ipc=host "${tty_args[@]}" \
	--user "$(id -u):$(id -g)" "${env_args[@]}" \
	-v "$root:/work" -w /work/web "$image" \
	bash -euo pipefail -c '
installed=$(node -p "require(\"@playwright/test/package.json\").version" 2>/dev/null || true)
if [[ $installed != "$PLAYWRIGHT_EXPECTED_VERSION" ]]; then
	npm ci --no-audit --no-fund
fi
exec "$@"' bash "$@"
