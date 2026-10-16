package i18n

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestTranslate(t *testing.T) {
	pt := WithLocale(context.Background(), Portuguese)
	en := WithLocale(context.Background(), English)
	if got := T(en, "Publish latest"); got != "Publish latest" {
		t.Fatalf("English changed: %q", got)
	}
	if got := T(pt, "Publish latest"); got != ptBR["Publish latest"] {
		t.Fatalf("Portuguese: %q", got)
	}
	if got := T(pt, "Untranslated text"); got != "Untranslated text" {
		t.Fatalf("fallback: %q", got)
	}
	if got, want := T(pt, "5 min ago"), strings.Replace(ptBR["%d min ago"], "%d", "5", 1); got != want {
		t.Fatalf("number pattern: %q, want %q", got, want)
	}
	if got, want := Tf(pt, "Publishing %s at %s.", "api", "abc1234"), fmt.Sprintf(ptBR["Publishing %s at %s."], "api", "abc1234"); got != want || got == "Publishing api at abc1234." {
		t.Fatalf("format: %q", got)
	}
	if got := T(context.Background(), "Publish latest"); got != "Publish latest" {
		t.Fatalf("default locale is not English: %q", got)
	}
}

func TestDetect(t *testing.T) {
	for _, c := range []struct {
		cookie, accept string
		want           Locale
	}{
		{"", "", English},
		{"", "pt-BR,pt;q=0.9,en;q=0.8", Portuguese},
		{"", "fr-FR, en-US;q=0.8", English},
		{"", "de-DE", English},
		{"en", "pt-BR", English},
		{"pt-BR", "en-US", Portuguese},
		{"xx", "pt-PT", Portuguese},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		if c.cookie != "" {
			r.Header.Set("Cookie", Cookie+"="+c.cookie)
		}
		r.Header.Set("Accept-Language", c.accept)
		if got := Detect(r); got != c.want {
			t.Errorf("cookie %q accept %q: %s, want %s", c.cookie, c.accept, got, c.want)
		}
	}
}

func TestSwitchURL(t *testing.T) {
	for in, want := range map[string]string{
		"/apps/x/logs?deployment=runtime": "/apps/x/logs?deployment=runtime&lang=pt-BR",
		"/?lang=en":                       "/?lang=pt-BR",
		"":                                "/?lang=pt-BR",
		"//evil.example/x":                "/?lang=pt-BR",
		"https://evil.example/":           "/?lang=pt-BR",
	} {
		if got := SwitchURL(in, Portuguese); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}

// TestCatalogCoversInterface fails when interface text is added without a
// Portuguese translation, or when the catalog's placeholders don't match.
func TestCatalogCoversInterface(t *testing.T) {
	lit := regexp.MustCompile(`i18n\.Tf?\((?:ctx|r\.Context\(\)), ("(?:[^"\\]|\\.)*")`)
	var files []string
	for _, pattern := range []string{"../*.go", "../pages/*.go", "../pages/*.templ", "../ui/*.go", "../ui/*.templ"} {
		m, _ := filepath.Glob(pattern)
		files = append(files, m...)
	}
	seen := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_templ.go") || strings.HasSuffix(f, "_test.go") || strings.Contains(f, "gallery") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range lit.FindAllSubmatch(src, -1) {
			key, err := strconv.Unquote(string(m[1]))
			if err != nil {
				t.Fatal(err)
			}
			seen++
			if _, ok := ptBR[key]; !ok {
				t.Errorf("%s: no Portuguese translation for %q", f, key)
			}
		}
	}
	if seen < 200 {
		t.Fatalf("found only %d interface strings; the scan is broken", seen)
	}
	verbs := regexp.MustCompile(`%[sd]`)
	for k, v := range ptBR {
		if strings.Join(verbs.FindAllString(k, -1), "") != strings.Join(verbs.FindAllString(v, -1), "") {
			t.Errorf("placeholders differ: %q -> %q", k, v)
		}
	}
	for _, k := range ScriptKeys {
		if _, ok := ptBR[k]; !ok {
			t.Errorf("script key %q has no translation", k)
		}
	}
}
