// Package static serves the panel's fingerprinted, precompressed browser assets.
// Run `make web` to rebuild web/static/dist from its sources.
package static

import (
	"embed"
	"encoding/json"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

//go:embed dist
var files embed.FS

var manifest = func() map[string]string {
	b, err := files.ReadFile("dist/manifest.json")
	if err != nil {
		panic("static: missing manifest; run make web")
	}
	m := map[string]string{}
	if err := json.Unmarshal(b, &m); err != nil {
		panic("static: invalid manifest")
	}
	return m
}()

// Prefix is the URL path under which assets are served.
const Prefix = "/assets/"

// Path returns the immutable URL of a logical asset such as "app.css".
// Unknown names panic so a missing asset fails tests instead of shipping a broken link.
func Path(name string) string {
	hashed, ok := manifest[name]
	if !ok {
		panic("static: unknown asset " + name)
	}
	return Prefix + hashed
}

// Names lists the logical assets in the manifest.
func Names() []string {
	out := make([]string, 0, len(manifest))
	for name := range manifest {
		out = append(out, name)
	}
	return out
}

// Size returns the stored size of an asset with the given encoding suffix ("", ".br" or ".zst").
func Size(name, suffix string) int {
	b, err := files.ReadFile("dist/" + manifest[name] + suffix)
	if err != nil {
		return 0
	}
	return len(b)
}

// Handler serves hashed assets with long-lived immutable caching, choosing the
// best precompressed variant accepted by the client.
func Handler() http.Handler {
	known := map[string]bool{}
	for _, hashed := range manifest {
		known[hashed] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, Prefix)
		if !known[name] {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
		h.Set("Vary", "Accept-Encoding")
		h.Set("ETag", strconv.Quote(name))
		if t := mime.TypeByExtension(path.Ext(name)); t != "" {
			h.Set("Content-Type", t)
		}
		if match := r.Header.Get("If-None-Match"); match == strconv.Quote(name) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		file := "dist/" + name
		encoding := ""
		for _, candidate := range []struct{ token, suffix string }{{"br", ".br"}, {"zstd", ".zst"}} {
			if accepts(r.Header.Get("Accept-Encoding"), candidate.token) {
				if _, err := fs.Stat(files, file+candidate.suffix); err == nil {
					file += candidate.suffix
					encoding = candidate.token
					break
				}
			}
		}
		b, err := files.ReadFile(file)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if encoding != "" {
			h.Set("Content-Encoding", encoding)
		}
		h.Set("Content-Length", strconv.Itoa(len(b)))
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(b)
	})
}

// accepts reports whether an Accept-Encoding header allows token with a nonzero quality.
func accepts(header, token string) bool {
	for part := range strings.SplitSeq(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(fields[0]), token) {
			continue
		}
		for _, param := range fields[1:] {
			param = strings.TrimSpace(param)
			if q, ok := strings.CutPrefix(param, "q="); ok {
				if v, err := strconv.ParseFloat(q, 64); err == nil && v == 0 {
					return false
				}
			}
		}
		return true
	}
	return false
}
