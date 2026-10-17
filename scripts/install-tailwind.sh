#!/usr/bin/env bash
# Install the pinned Tailwind CSS standalone CLI into .tools after verifying its SHA-256.
set -euo pipefail
version=4.3.3
dest=${1:-.tools}
case "$(uname -s)-$(uname -m)" in
Linux-x86_64) asset=tailwindcss-linux-x64 sum=dc61b3ac6b8c9ca874c0cc4c57b2409791a64c5540404ca5f5367360babc313a ;;
Linux-aarch64) asset=tailwindcss-linux-arm64 sum=55fd0b241214eff3de1e8ee4f22796662f2d2e7a49bcfca7477cfd0bac398195 ;;
Darwin-arm64) asset=tailwindcss-macos-arm64 sum=cdf646702987a743464dff4d9c60fd4480d1c1e73dd819a9a67f1078815dce9d ;;
Darwin-x86_64) asset=tailwindcss-macos-x64 sum=7922e0953f2110c05976e3bf58f14e643d90427575e766b7d433f5f80cbee7e1 ;;
*) echo "Unsupported platform for the Tailwind CLI" >&2; exit 1 ;;
esac
if [[ -x $dest/tailwindcss && $("$dest/tailwindcss" --help 2>&1 | head -n1) == *"v$version"* ]]; then
	exit 0
fi
mkdir -p "$dest"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/tailwindlabs/tailwindcss/releases/download/v$version/$asset" -o "$tmp"
echo "$sum  $tmp" | sha256sum --check --status - || { echo "Tailwind CLI checksum mismatch" >&2; exit 1; }
install -m 0755 "$tmp" "$dest/tailwindcss"
