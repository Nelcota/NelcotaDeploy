#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$repo"
# Include current edits and new files, but never copy dependency/build caches.
git ls-files --cached --others --exclude-standard --deduplicate -z |
  while IFS= read -r -d '' name; do
    if [[ -e "$name" || -L "$name" ]]; then printf '%s\0' "$name"; fi
  done | tar --null -T - -cf - | tar -C "$scratch" -xf -
make -C "$scratch" generate TOOLS="$repo/.tools" GO="${GO:-go}"
diff -ru "$repo/internal/gen" "$scratch/internal/gen"
diff -ru "$repo/internal/store/dbgen" "$scratch/internal/store/dbgen"
