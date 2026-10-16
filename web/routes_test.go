package web

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/nelcota/nelcota-deploy/internal/service"
)

func TestPagesRequireSessionAndDevelopmentIsExplicit(t *testing.T) {
	for _, dev := range []bool{false, true} {
		r := chi.NewRouter()
		Register(r, service.Services{}, dev)
		for _, path := range []string{"/", "/apps/example", "/servers", "/settings", "/security"} {
			response := httptest.NewRecorder()
			r.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
			if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/login" {
				t.Fatalf("unprotected page %s: %d", path, response.Code)
			}
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest("GET", "/login", nil))
		if !strings.Contains(response.Body.String(), `data-dev="`+map[bool]string{false: "false", true: "true"}[dev]+`"`) {
			t.Fatal("development mode not explicit")
		}
		if strings.Contains(response.Body.String(), "<script>") {
			t.Fatal("inline script conflicts with CSP")
		}
		req := httptest.NewRequest("GET", "/", nil).WithContext(service.WithPrincipal(context.Background(), service.Principal{ID: "member", Role: "member"}))
		response = httptest.NewRecorder()
		r.ServeHTTP(response, req)
		if response.Code != 200 || !strings.Contains(response.Body.String(), `data-view="dashboard"`) {
			t.Fatal("authenticated dashboard unavailable")
		}
	}
}

func TestAssetsAreVersionedAndImmutable(t *testing.T) {
	r := chi.NewRouter()
	Register(r, service.Services{})
	for name, version := range assetVersions {
		url := "/assets/" + version + "/" + name
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest("GET", url, nil))
		if response.Code != 200 || !strings.Contains(response.Header().Get("Cache-Control"), "immutable") || response.Body.Len() == 0 {
			t.Fatal("asset not served with immutable version", name)
		}
		req := httptest.NewRequest("GET", url, nil)
		req.Header.Set("If-None-Match", response.Header().Get("ETag"))
		cached := httptest.NewRecorder()
		r.ServeHTTP(cached, req)
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatal("ETag ignored")
		}
		head := httptest.NewRecorder()
		r.ServeHTTP(head, httptest.NewRequest("HEAD", url, nil))
		if head.Code != 200 || head.Body.Len() != 0 {
			t.Fatal("HEAD should not return body")
		}
		missing := httptest.NewRecorder()
		r.ServeHTTP(missing, httptest.NewRequest("GET", "/assets/wrong/"+name, nil))
		if missing.Code != 404 {
			t.Fatal("unversioned asset accepted")
		}
	}
}

func TestAssetCompressionAndNegotiation(t *testing.T) {
	r := chi.NewRouter()
	Register(r, service.Services{})
	for _, row := range []struct {
		accept     string
		compressed bool
	}{{"gzip, deflate, br", true}, {"gzip;q=0, *;q=1", false}, {"br", false}, {"*;q=1", true}} {
		req := httptest.NewRequest("GET", "/assets/"+assetVersions["app.js"]+"/app.js", nil)
		req.Header.Set("Accept-Encoding", row.accept)
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		if (response.Header().Get("Content-Encoding") == "gzip") != row.compressed {
			t.Fatal("encoding negotiation", row.accept)
		}
		data := response.Body.Bytes()
		if row.compressed {
			reader, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			data, err = io.ReadAll(reader)
			reader.Close()
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(response.Header().Get("ETag"), "-gzip") {
				t.Fatal("representation lacks distinct ETag")
			}
		}
		if !bytes.Equal(data, assetBodies["app.js"]) {
			t.Fatal("asset changed during compression")
		}
	}
}
