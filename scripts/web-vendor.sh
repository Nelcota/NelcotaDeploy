#!/usr/bin/env bash
# Refresh vendored browser libraries from pinned npm packages (web/package-lock.json)
# and the pinned Datastar release. The Go build only reads the committed copies.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
web=$root/web
vendor=$web/static/vendor
icons=$web/ui/icons
modules=$web/node_modules
(cd "$web" && npm ci --no-audit --no-fund)
rm -rf "$vendor" "$icons"
mkdir -p "$vendor/basecoat/base" "$vendor/basecoat/components" "$vendor/basecoat/styles" "$icons"

datastar_version=v1.0.4
datastar_sum=727844adfc825ee651fb93c544a2a739986f9a21820a94524b35f0cac470cf91
curl --proto '=https' --tlsv1.2 -fsSL "https://raw.githubusercontent.com/starfederation/datastar/$datastar_version/bundles/datastar.js" -o "$vendor/datastar.js"
echo "$datastar_sum  $vendor/datastar.js" | sha256sum --check --status - || { echo "Datastar checksum mismatch" >&2; exit 1; }

cp "$modules/@xterm/xterm/lib/xterm.js" "$vendor/xterm.js"
cp "$modules/@xterm/xterm/css/xterm.css" "$vendor/xterm.css"
cp "$modules/@xterm/addon-fit/lib/addon-fit.js" "$vendor/xterm-addon-fit.js"
cp "$modules/uplot/dist/uPlot.iife.min.js" "$vendor/uplot.js"
cp "$modules/uplot/dist/uPlot.min.css" "$vendor/uplot.css"
# Outfit variable font (SIL OFL 1.1), Latin subset, served from the panel origin.
(cd "$web" && node subset-font.mjs "$modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2" "$vendor/outfit.woff2")
cp "$modules/@fontsource-variable/outfit/LICENSE" "$vendor/outfit-LICENSE"
# Source maps are not shipped.
sed -i '/^\/\/# sourceMappingURL=/d' "$vendor"/*.js

basecoat=$modules/basecoat-css/dist
cp "$basecoat/base/base.css" "$vendor/basecoat/base/"
cp "$basecoat/components/"*.css "$vendor/basecoat/components/"
cp "$basecoat/styles/vega.css" "$vendor/basecoat/styles/"
cp "$modules/basecoat-css/LICENSE"* "$vendor/basecoat/" 2>/dev/null || true

# Lucide icons used by web/ui. Add a name here, then run make web-vendor.
for name in layout-dashboard server settings arrow-up-from-line git-branch terminal scroll-text users key-round \
	database-backup history download refresh-cw x check circle-alert circle-check circle-x loader-circle \
	sun moon monitor search plus trash-2 eye copy pause play square rotate-ccw undo-2 circle-arrow-up \
	log-out menu chevron-right cpu clock info triangle-alert external-link lock fingerprint smartphone \
	user-plus filter ban sliders-horizontal globe arrow-down-to-line brush-cleaning activity box link \
	user camera image-up rotate-cw flip-horizontal-2 mail message-square cloud webhook bell hard-drive memory-stick database layers package; do
	cp "$modules/lucide-static/icons/$name.svg" "$icons/"
done
cp "$modules/lucide-static/LICENSE" "$icons/LICENSE"
# Lucide has no brand marks: the GitHub mark comes from Octicons. Icons render
# as outlines (fill="none"), so the filled mark sets its own fill.
sed 's/<path /<path fill="currentColor" stroke="none" /' "$modules/@primer/octicons/build/svg/mark-github-24.svg" >"$icons/github.svg"
cp "$modules/@primer/octicons/LICENSE" "$icons/LICENSE-octicons"

# Official brand marks from Simple Icons (CC0; the marks stay their owners'
# trademarks, used only to name the product). Add a slug here, then run
# make web-vendor. brands.json keeps each title, color, and guidelines link.
brands=$web/ui/brands
rm -rf "$brands"
mkdir -p "$brands"
brand_slugs=(nodedotjs bun deno go python rust ruby php openjdk dotnet elixir erlang nginx caddy apache docker
	github git discord cloudflare backblaze minio debian ubuntu wireguard letsencrypt)
for slug in "${brand_slugs[@]}"; do
	cp "$modules/simple-icons/icons/$slug.svg" "$brands/"
done
cp "$modules/simple-icons/LICENSE.md" "$brands/LICENSE.md"
cp "$modules/simple-icons/DISCLAIMER.md" "$brands/DISCLAIMER.md"
(cd "$web" && node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync("node_modules/simple-icons/data/simple-icons.json", "utf8"));
const list = Array.isArray(data) ? data : data.icons;
const out = {};
for (const slug of process.argv.slice(1).sort()) {
	const svg = fs.readFileSync("node_modules/simple-icons/icons/" + slug + ".svg", "utf8");
	const title = svg.match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "\x27");
	const icon = list.find((i) => i.title === title);
	if (!icon) { console.error("missing brand " + slug); process.exit(1); }
	out[slug] = { title: icon.title, hex: icon.hex, guidelines: icon.guidelines || "" };
}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
' "${brand_slugs[@]}") >"$brands/brands.json"

# Full-color logos from Devicon (MIT) where the official mark has more than one
# color or Simple Icons draws it differently. Each is saved under its Simple
# Icons slug and replaces that mark wherever it is shown. Go, Node.js, Deno,
# Rust, and nginx keep their Simple Icons marks: those are the official ones
# or stay visible on the dark theme.
mkdir -p "$brands/color"
for pair in python:python openjdk:java php:php dotnet:dotnetcore ruby:ruby elixir:elixir bun:bun apache:apache; do
	cp "$modules/devicon/icons/${pair#*:}/${pair#*:}-original.svg" "$brands/color/${pair%%:*}.svg"
done
cp "$modules/devicon/LICENSE" "$brands/color/LICENSE"
