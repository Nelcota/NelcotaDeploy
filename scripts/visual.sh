#!/usr/bin/env bash
# Visual regression of the component gallery inside the pinned Playwright image.
#   scripts/visual.sh check   compare against committed container baselines
#   scripts/visual.sh update  regenerate the baselines (commit the PNG files)
# Requires Docker and bin/nelcota-panel (make build). Used by make visual and CI.
set -euo pipefail
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
mode=${1:-check}
root=$(cd "$(dirname "$0")/.." && pwd)
baselines=web/e2e/visual.spec.js-snapshots/container
args=(npx playwright test -c playwright.visual.config.js e2e/visual.spec.js)
case $mode in
check) ;;
update) args+=(--update-snapshots=all) ;;
*) fail 'Usage: scripts/visual.sh check|update' ;;
esac
# Check infrastructure here so a missing daemon is not reported as missing baselines.
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
	fail 'Docker is required for visual regression (make visual); start the daemon and retry'
fi
log=$(mktemp)
trap 'rm -f "$log"' EXIT
set +e
VISUAL=1 PLAYWRIGHT_CONTAINER_ENV=VISUAL "$root/scripts/playwright-container.sh" "${args[@]}" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
if [[ $mode == update ]]; then
	((status == 0)) || fail 'Baseline update failed; see the output above'
	printf 'Updated baselines in %s:\n' "$baselines"
	(cd "$root" && git status --short -- "$baselines")
	exit 0
fi
((status == 0)) && exit 0
shopt -s nullglob
existing=("$root/$baselines"/*.png)
if ((${#existing[@]} == 0)) || grep -q "snapshot doesn't exist" "$log"; then
	cat >&2 <<EOF

Visual baselines are missing in $baselines.
They must be rendered inside the pinned Playwright container, never on a host:
  make build visual-update
then review and commit the new PNG files. The screenshots rendered by this run
are in web/test-results/ (uploaded as the "visual-actual" artifact in CI).
EOF
else
	cat >&2 <<EOF

The component gallery differs from the baselines in $baselines.
Inspect web/test-results/ (expected, actual, and diff images; the "visual-actual"
artifact in CI). If the change is intended, run "make build visual-update" and
commit the updated PNG files.
EOF
fi
exit 1
