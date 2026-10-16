# Web interface

Server-rendered panel built with [templ](https://templ.guide), [Datastar](https://data-star.dev) 1.0, Tailwind CSS v4 with [Basecoat](https://basecoatui.com), [Lucide](https://lucide.dev) icons, [uPlot](https://github.com/leeoniya/uPlot), and [xterm.js](https://xtermjs.org). `internal/httpapi` calls `web.Register(r, web.Config{...})`. Handlers call `internal/service` only; authorization and business rules stay there. See the [frontend contract](../docs/frontend-contract.md) and [frontend report](../docs/frontend-report.md).

| Path | Contents |
| --- | --- |
| `*.go` | Page handlers, Datastar actions under `/ui`, live streams, SSE writer |
| `pages/`, `ui/` | templ pages and shared components (`*_templ.go` are generated and committed) |
| `ui/icons/` | Lucide SVG subset (vendored) |
| `i18n/` | Interface languages: English source strings and the Brazilian Portuguese catalog |
| `static/src/` | Tailwind input (`app.css`), panel scripts, mascot and favicon images |
| `static/vendor/` | Pinned Datastar, xterm.js, uPlot, and Basecoat copies (`make web-vendor`) |
| `static/dist/` | Generated, content-hashed assets with Brotli and zstd variants (embedded) |
| `internal/assetgen/` | Deterministic fingerprinting and precompression |
| `e2e/` | Playwright tests (`make e2e`) and screenshot generator |

`make web` regenerates templ code, CSS, and assets; `make check-generated` verifies the committed output. Node is needed only for `make web-vendor` and `make e2e`.

## Languages

English is the source language; `i18n/pt_br.go` translates it to Brazilian Portuguese. Wrap interface text in `i18n.T(ctx, "...")`, or `i18n.Tf(ctx, "Publishing %s at %s.", ...)` when it contains values, and add the translation to the catalog. Components translate their text parameters, so pass English literals to them. A key with `%d` also matches the same text with any number ("5 min ago" uses `"%d min ago"`). Use `i18n.TC(ctx, "context", s)` when one English word needs two translations. Scripts call `Nelcota.t(...)`; list their strings in `ScriptKeys` so pages embed them. `TestCatalogCoversInterface` fails when a literal has no translation, and `SCAN_ENGLISH=1 go test -run TestScanEnglish -v ./web/` lists English left on Portuguese pages.

The language comes from the `nelcota_lang` cookie, then `Accept-Language`, then English. Signed-in people choose the language and theme under Settings › Account › Preferences; the sign-in pages keep a small flag menu and theme toggle. Both language controls link to the same page with `?lang=`, which stores the cookie and redirects without the parameter, so it works without scripts and is excluded from prefetching.

## Keyboard

Ctrl K (⌘K) opens the command palette. "g" then a letter opens a primary page: H Home, A Apps, S Servers, C Settings. The rail links declare these with `aria-keyshortcuts`, and `app.js` reads them, so a new destination only needs the attribute.
