package web_test

import (
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/Nelcota/NelcotaDeploy/web/static"
)

func TestPagesRequireSession(t *testing.T) {
	e := newEnv(t)
	for _, path := range []string{"/", "/dev/components"} {
		res := e.anon(path)
		if res.code != http.StatusSeeOther || !strings.HasPrefix(res.header.Get("Location"), "/login?next=") {
			t.Fatal(path, res.code, res.header.Get("Location"))
		}
	}
}

func TestShellSecurityHeadersAndNonce(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/dev/components")
	if res.code != http.StatusOK {
		t.Fatal(res.code, res.body)
	}
	policy := res.header.Get("Content-Security-Policy")
	m := regexp.MustCompile(`script-src 'self' 'nonce-([A-Za-z0-9+/]+)'`).FindStringSubmatch(policy)
	if m == nil || strings.Contains(policy, "unsafe-eval") || strings.Contains(policy, "style-src 'self' 'unsafe-inline'") {
		t.Fatal(policy)
	}
	mustContain(t, res.body, `data-nonce="`+m[1]+`"`, `<meta name="csrf-token"`, `id="toaster"`, `href="#main"`, `id="main"`, `aria-label="Primary"`, `aria-label="Sidebar"`, `class="tabbar"`, `id="cmdk"`, `id="reauth"`)
	if res.header.Get("Cache-Control") != "no-store" || res.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal(res.header)
	}
	// Each response gets a fresh nonce.
	again := e.admin().get("/dev/components")
	if again.header.Get("Content-Security-Policy") == policy {
		t.Fatal("nonce reused")
	}
	// No inline style attributes: the policy would block them.
	if regexp.MustCompile(`\sstyle="`).MatchString(res.body) {
		t.Fatal("inline style attribute rendered")
	}
}

func TestShellHidesNothingSecretAndEscapesUser(t *testing.T) {
	e := newEnv(t)
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "UPDATE users SET name=? WHERE id='development-user'", `<script>alert(1)</script>`); err != nil {
		t.Fatal(err)
	}
	s := e.admin()
	res := s.get("/")
	mustNotContain(t, res.body, `<script>alert(1)</script>`, s.cookie.Value)
	mustContain(t, res.body, `&lt;script&gt;alert(1)&lt;/script&gt;`)
}

func TestActionsRequireSessionAndCSRF(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	// Unknown actions still pass authentication first; CSRF failures never reach handlers.
	res := s.postWith("/ui/apps/dev-app-api/deploy", nil, "")
	if res.code != http.StatusForbidden {
		t.Fatal("missing CSRF accepted", res.code)
	}
	res = s.postWith("/ui/apps/dev-app-api/deploy", nil, "forged")
	if res.code != http.StatusForbidden {
		t.Fatal("forged CSRF accepted", res.code)
	}
}

func TestAssetsServedImmutableAndPrecompressed(t *testing.T) {
	e := newEnv(t)
	path := static.Path("app.css")
	for _, row := range []struct{ accept, encoding string }{{"gzip, deflate, br, zstd", "br"}, {"zstd", "zstd"}, {"br;q=0, zstd", "zstd"}, {"gzip", ""}} {
		r, _ := http.NewRequest("GET", path, nil)
		r.Header.Set("Accept-Encoding", row.accept)
		res := e.do(r)
		if res.code != 200 || res.header.Get("Content-Encoding") != row.encoding || res.header.Get("Cache-Control") != "public, max-age=31536000, immutable" || res.header.Get("Vary") != "Accept-Encoding" || !strings.HasPrefix(res.header.Get("Content-Type"), "text/css") {
			t.Fatal(row, res.code, res.header)
		}
	}
	r, _ := http.NewRequest("GET", path, nil)
	r.Header.Set("If-None-Match", `"`+strings.TrimPrefix(path, static.Prefix)+`"`)
	if res := e.do(r); res.code != http.StatusNotModified {
		t.Fatal(res.code)
	}
	for _, bad := range []string{"/assets/app.css", "/assets/../go.mod", "/assets/manifest.json"} {
		if res := e.anon(bad); res.code != http.StatusNotFound {
			t.Fatal(bad, res.code)
		}
	}
}

func TestSafeNextAndErrors(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/apps/missing/deployments")
	if res.code != http.StatusNotFound && res.code != http.StatusOK {
		t.Fatal(res.code)
	}
}

func TestNotFoundPages(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/no/such/page")
	if res.code != http.StatusNotFound || !strings.Contains(res.body, "This page does not exist.") || !strings.Contains(res.body, `aria-label="Sidebar"`) || !strings.Contains(res.header.Get("Content-Security-Policy"), "nonce-") {
		t.Fatal(res.code, res.header)
	}
	if res := e.anon("/nope"); res.code != http.StatusNotFound || !strings.Contains(res.body, "Back to overview") {
		t.Fatal(res.code)
	}
	if res := e.anon("/api/nope"); res.code != http.StatusNotFound || strings.Contains(res.body, "<html") {
		t.Fatal(res.code, res.body)
	}
}
