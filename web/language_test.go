package web_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/ui"
)

// get with an extra header.
func (s *session) getWith(path, header, value string) response {
	r := httptest.NewRequest("GET", path, nil)
	r.AddCookie(s.cookie)
	r.Header.Set(header, value)
	return s.e.do(r)
}

func TestLanguageSwitchStoresChoiceAndStaysOnPage(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/apps/dev-app-api/logs?deployment=runtime&lang=pt-BR")
	if res.code != http.StatusSeeOther || res.header.Get("Location") != "/apps/dev-app-api/logs?deployment=runtime" {
		t.Fatal(res.code, res.header.Get("Location"))
	}
	c := (&http.Response{Header: res.header}).Cookies()
	if len(c) != 1 || c[0].Name != "nelcota_lang" || c[0].Value != "pt-BR" || !c[0].HttpOnly || c[0].SameSite != http.SameSiteLaxMode || c[0].MaxAge <= 0 {
		t.Fatalf("%+v", c)
	}
	// Unknown languages are ignored; the parameter is still removed.
	res = e.anon("/login?lang=xx")
	if res.code != http.StatusSeeOther || res.header.Get("Location") != "/login" || len((&http.Response{Header: res.header}).Cookies()) != 0 {
		t.Fatal(res.code, res.header)
	}
}

func TestPortuguesePages(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	pt := func(path string) response {
		r := httptest.NewRequest("GET", path, nil)
		r.AddCookie(s.cookie)
		r.AddCookie(&http.Cookie{Name: "nelcota_lang", Value: "pt-BR"})
		return e.do(r)
	}
	ctx := i18n.WithLocale(context.Background(), i18n.Portuguese)
	tr := func(s string) string {
		t.Helper()
		v := i18n.T(ctx, s)
		if v == s {
			t.Fatalf("no translation for %q", s)
		}
		return v
	}
	home := pt("/")
	mustContain(t, home.body, `<html lang="pt-BR"`, ">"+tr("Home")+"<", tr("Get your first app online"), `id="i18n"`, ui.JS(tr("Copied to clipboard")))
	// Language and theme are settings, not sidebar controls.
	mustNotContain(t, home.body, "Get your first app online", "hreflang=", "data-theme-toggle")
	mustContain(t, pt("/apps/dev-app-api").body, tr("Publish latest"), tr("Overview"))
	mustContain(t, pt("/settings").body, tr("Passkeys"), tr("Preferences"), `href="/settings?lang=en"`, `hreflang="pt-BR"`, `aria-current="true"`, `data-no-prefetch`, `data-theme-select`)

	// Accept-Language picks Portuguese without a stored choice; English stays the default.
	mustContain(t, s.getWith("/", "Accept-Language", "pt-BR,pt;q=0.9").body, `<html lang="pt-BR"`)
	en := s.getWith("/", "Accept-Language", "fr-FR,de;q=0.8").body
	mustContain(t, en, `<html lang="en"`, "Get your first app online")
	mustNotContain(t, en, `id="i18n"`)

	// Actions answer in the viewer's language.
	r := httptest.NewRequest("POST", "/ui/apps/dev-app-api/deploy?latest=1", strings.NewReader(url.Values{}.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Origin", origin)
	r.Header.Set("Datastar-Request", "true")
	r.Header.Set("X-CSRF-Token", s.csrf)
	r.AddCookie(s.cookie)
	r.AddCookie(&http.Cookie{Name: "nelcota_lang", Value: "pt-BR"})
	res := e.do(r)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, strings.TrimSuffix(i18n.Tf(ctx, "Publishing %s at %s.", "api", ""), "."))
}

func TestSignInPageOffersLanguages(t *testing.T) {
	e := newEnv(t)
	res := e.anon("/login")
	mustContain(t, res.body, `href="/login?lang=pt-BR"`, i18n.Name(i18n.Portuguese), "English")
}
