package web_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"
)

func TestAppLogo(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	page := s.get("/apps/dev-app-api/settings").body
	mustContain(t, page, `id="app-logo"`, `id="app-header-logo"`, `name="logo"`, "Upload logo")
	mustNotContain(t, page, "Remove logo", `src="/app-logos/`)

	if res := s.upload("/ui/apps/dev-app-api/logo", "logo", photo(t), ""); res.code == http.StatusOK && toast(res.body) == "success" {
		t.Fatal("uploaded without a CSRF token")
	}
	if res := s.upload("/ui/apps/dev-app-api/logo", "logo", []byte("<svg onload=alert(1)>"), s.csrf); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	if m := e.member(); toast(m.upload("/ui/apps/dev-app-api/logo", "logo", photo(t), m.csrf).body) != "danger" {
		t.Fatal("a member changed the logo")
	}
	res := s.upload("/ui/apps/dev-app-api/logo", "logo", photo(t), s.csrf)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "Logo saved.", `id="app-logo"`, `id="app-header-logo"`, `src="/app-logos/dev-app-api?v=`, "Change logo", "Remove logo")

	// The dashboard and the app list show it in place of the initial.
	for _, path := range []string{"/", "/apps"} {
		mustContain(t, s.get(path).body, `src="/app-logos/dev-app-api?v=`)
	}
	page = s.get("/apps/dev-app-api").body
	i := strings.Index(page, `src="/app-logos/dev-app-api?v=`)
	if i < 0 {
		t.Fatal("logo not shown in the app header")
	}
	src := page[i+5 : i+5+strings.Index(page[i+5:], `"`)]
	img := s.get(src)
	if img.code != http.StatusOK || img.header.Get("Content-Type") != "image/png" || !strings.Contains(img.header.Get("Cache-Control"), "immutable") || !strings.Contains(img.header.Get("Content-Security-Policy"), "sandbox") || !bytes.HasPrefix([]byte(img.body), []byte("\x89PNG")) {
		t.Fatal(img.code, img.header)
	}
	// Teammates see it; signed-out visitors don't.
	mustContain(t, e.member().get("/app-logos/dev-app-api").header.Get("Content-Type"), "image/png")
	if anon := e.anon("/app-logos/dev-app-api"); anon.code != http.StatusSeeOther {
		t.Fatal(anon.code)
	}

	res = s.post("/ui/apps/dev-app-api/logo/remove", nil)
	mustContain(t, res.body, "Logo removed.", "Upload logo")
	if s.get("/app-logos/dev-app-api").code != http.StatusNotFound {
		t.Fatal("logo still served")
	}
}
