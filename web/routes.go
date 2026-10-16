// Package web embeds the panel UI in the same binary as its API.
package web

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"fmt"
	"html/template"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nelcota/nelcota-deploy/internal/service"
)

//go:embed assets/*
var assets embed.FS

var assetBodies = map[string][]byte{}
var compressedAssets = map[string][]byte{}

var assetVersions = func() map[string]string {
	versions := map[string]string{}
	for _, name := range []string{"app.js", "app.css"} {
		data, err := assets.ReadFile("assets/" + name)
		if err != nil {
			panic(err)
		}
		versions[name] = fmt.Sprintf("%x", sha256.Sum256(data))[:16]
		assetBodies[name] = data
		var buffer bytes.Buffer
		writer, err := gzip.NewWriterLevel(&buffer, gzip.BestSpeed)
		if err != nil {
			panic(err)
		}
		if _, err = writer.Write(data); err != nil {
			panic(err)
		}
		if err = writer.Close(); err != nil {
			panic(err)
		}
		compressedAssets[name] = buffer.Bytes()
	}
	return versions
}()

func acceptsGzip(value string) bool {
	wildcard := false
	for _, item := range strings.Split(value, ",") {
		parts := strings.Split(item, ";")
		name := strings.TrimSpace(parts[0])
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && key == "q" {
				q, err := strconv.ParseFloat(value, 64)
				if err != nil || q < 0 || q > 1 {
					quality = 0
				} else {
					quality = q
				}
			}
		}
		if name == "gzip" {
			return quality > 0
		}
		if name == "*" {
			wildcard = quality > 0
		}
	}
	return wildcard
}

var shell = template.Must(template.New("panel").Parse(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Nelcota Deploy</title><link rel="stylesheet" href="{{.CSS}}"><script type="module" src="{{.JS}}"></script></head>
<body data-view="{{.View}}" data-app="{{.App}}" data-dev="{{.Dev}}">
<a class="skip" href="#content">Ir para o conteúdo</a>
<aside class="sidebar"><a class="brand" href="/"><span class="mark">N</span> Nelcota <small>DEPLOY</small></a><p class="eyebrow">SEU CÓDIGO. SEUS SERVIDORES.</p><nav aria-label="Principal"><a href="/" data-nav="dashboard">◈ Visão geral</a><a href="/servers" data-nav="servers">▤ Servidores</a><a href="/settings" data-nav="settings">⚙ Ajustes</a><a href="/security" data-nav="security">◇ Segurança</a></nav><div class="sidebar-bottom"><button id="commands" class="quiet">Navegar <kbd>⌘ K</kbd></button><button id="theme" class="quiet">Alternar tema</button><p id="identity"></p><button id="logout" class="quiet" hidden>Sair da conta</button></div></aside>
<div class="workspace"><header class="topbar"><span id="breadcrumb">Painel de controle</span><span id="connection" role="status">Conectando…</span></header><main id="content" tabindex="-1"><p role="status">Carregando painel…</p></main><footer>Nelcota Deploy · infraestrutura sob seu controle</footer></div>
<div id="notice" role="status" aria-live="polite" hidden></div>
<dialog id="modal" aria-labelledby="modal-title"><form method="dialog" class="dialog-close"><button aria-label="Fechar">×</button></form><h2 id="modal-title"></h2><div id="modal-content"></div></dialog>
<noscript>Ative JavaScript para usar a interface. A API continua disponível para clientes autenticados.</noscript></body></html>`))

type page struct {
	View, App, CSS, JS string
	Dev                bool
}

func Register(r chi.Router, _ service.Services, development ...bool) {
	dev := len(development) != 0 && development[0]
	serveAsset := func(w http.ResponseWriter, req *http.Request) {
		name := chi.URLParam(req, "name")
		version, ok := assetVersions[name]
		if !ok || chi.URLParam(req, "version") != version {
			http.NotFound(w, req)
			return
		}
		data := assetBodies[name]
		etag := version
		w.Header().Set("Vary", "Accept-Encoding")
		if acceptsGzip(req.Header.Get("Accept-Encoding")) {
			data = compressedAssets[name]
			etag += "-gzip"
			w.Header().Set("Content-Encoding", "gzip")
		}
		if strings.HasSuffix(name, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		} else {
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("ETag", `"`+etag+`"`)
		if req.Header.Get("If-None-Match") == `"`+etag+`"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		if req.Method != http.MethodHead {
			_, _ = w.Write(data)
		}
	}
	r.Get("/assets/{version}/{name}", serveAsset)
	r.Head("/assets/{version}/{name}", serveAsset)
	render := func(view string, public bool) http.HandlerFunc {
		return func(w http.ResponseWriter, req *http.Request) {
			if !public {
				if _, err := service.CurrentUser(req.Context()); err != nil {
					http.Redirect(w, req, "/login", http.StatusSeeOther)
					return
				}
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_ = shell.Execute(w, page{View: view, App: chi.URLParam(req, "id"), Dev: dev, CSS: path.Join("/assets", assetVersions["app.css"], "app.css"), JS: path.Join("/assets", assetVersions["app.js"], "app.js")})
		}
	}
	r.Get("/", render("dashboard", false))
	r.Get("/apps/{id}", render("app", false))
	r.Get("/servers", render("servers", false))
	r.Get("/settings", render("settings", false))
	r.Get("/security", render("security", false))
	r.Get("/login", render("login", true))
	r.Get("/register", render("register", true))
}
