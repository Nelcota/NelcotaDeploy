package web_test

import (
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"golang.org/x/net/html"
)

// englishAllowlist lists text that may stay in English on Portuguese pages:
// seed data, product and brand names, and technical terms. Digits are
// replaced with # so counts and times don't matter.
const englishAllowlist = "testdata/english-on-pt-pages.txt"

// TestPortuguesePagesHaveNoEnglish fails when English text appears on
// Portuguese pages and is not in the allowlist, or when an allowlist entry no
// longer appears. UPDATE_ENGLISH_ALLOWLIST=1 rewrites the list for review.
func TestPortuguesePagesHaveNoEnglish(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	words := regexp.MustCompile(`(?i)\b(the|your|you|and|with|this|from|for|to|of|is|are|not|no|yet|now|new|add|save|delete|remove|open|show|set|use|build|run|start|stop|server|servers|apps?|settings|deploy\w*|publish\w*|logs?|version|change\w*|failed|live|online|offline|waiting|copy|cancel|back|next|search|value|name|memory|disk|cache|images?|token|passkey|code|users?|team|role|update|backups?)\b`)
	found := map[string]bool{}
	digits := regexp.MustCompile(`[0-9]+`)
	for _, path := range []string{"/", "/apps", "/apps/new", "/apps/dev-app-api", "/apps/dev-app-store", "/apps/dev-app-api/deployments", "/apps/dev-app-api/logs", "/apps/dev-app-api/logs?deployment=runtime", "/apps/dev-app-api/settings", "/servers", "/settings", "/settings/users", "/settings/github", "/settings/audit", "/settings/platform", "/ui/cmdk", "/nope"} {
		r := httptest.NewRequest("GET", path, nil)
		r.AddCookie(s.cookie)
		r.AddCookie(&http.Cookie{Name: "nelcota_lang", Value: "pt-BR"})
		res := e.do(r)
		doc, err := html.Parse(strings.NewReader(res.body))
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]bool{}
		var walk func(n *html.Node, skip bool)
		walk = func(n *html.Node, skip bool) {
			if n.Type == html.ElementNode {
				switch n.Data {
				case "script", "style", "svg", "code", "pre", "textarea":
					skip = true
				}
				for _, a := range n.Attr {
					if a.Key == "aria-label" || a.Key == "placeholder" || a.Key == "title" || a.Key == "alt" {
						if v := strings.TrimSpace(a.Val); words.MatchString(v) && !seen[v] {
							seen[v] = true
							found[digits.ReplaceAllString(v, "#")] = true
						}
					}
				}
				for _, a := range n.Attr {
					if a.Key == "class" && strings.Contains(a.Val, "mono") {
						skip = true
					}
				}
			}
			if n.Type == html.TextNode && !skip {
				if v := strings.TrimSpace(n.Data); words.MatchString(v) && !seen[v] {
					seen[v] = true
					found[digits.ReplaceAllString(v, "#")] = true
				}
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c, skip)
			}
		}
		walk(doc, false)
	}
	checkAllowlist(t, found)
}

// portuguese recognizes text that is already Portuguese even when it keeps
// developer loanwords such as "app", "build", or "logs": it has an accented
// letter, or a word that the catalog's translations use and its English text
// doesn't. The word list comes from the catalog, so this file has none.
var portuguese = func() func(string) bool {
	word := regexp.MustCompile(`\p{L}+`)
	english, translated := map[string]bool{}, map[string]bool{}
	for en, pt := range i18n.Catalog(i18n.Portuguese) {
		for _, w := range word.FindAllString(strings.ToLower(en), -1) {
			english[w] = true
		}
		for _, w := range word.FindAllString(strings.ToLower(pt), -1) {
			translated[w] = true
		}
	}
	accent := regexp.MustCompile(`[\x{e0}-\x{ff}]`)
	return func(s string) bool {
		if accent.MatchString(s) {
			return true
		}
		for _, w := range word.FindAllString(strings.ToLower(s), -1) {
			if translated[w] && !english[w] {
				return true
			}
		}
		return false
	}
}()

func checkAllowlist(t *testing.T, found map[string]bool) {
	t.Helper()
	keys := make([]string, 0, len(found))
	for k := range found {
		if !portuguese(k) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	if os.Getenv("UPDATE_ENGLISH_ALLOWLIST") != "" {
		out := "# English text allowed on Portuguese pages (see TestPortuguesePagesHaveNoEnglish).\n# Only names, seed data, and technical terms belong here; translate everything else.\n" + strings.Join(keys, "\n") + "\n"
		if err := os.WriteFile(englishAllowlist, []byte(out), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	raw, err := os.ReadFile(englishAllowlist)
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{}
	for line := range strings.Lines(string(raw)) {
		line = strings.TrimRight(line, "\n")
		if line != "" && !strings.HasPrefix(line, "#") {
			allowed[line] = true
		}
	}
	for _, k := range keys {
		if !allowed[k] {
			t.Errorf("English on a Portuguese page: %q (translate it, or allow it in %s)", k, englishAllowlist)
		}
	}
	for k := range allowed {
		if !found[k] || portuguese(k) {
			t.Errorf("stale allowlist entry: %q", k)
		}
	}
}
