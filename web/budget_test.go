package web_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/Nelcota/NelcotaDeploy/web/static"
)

// TestPageScriptBudget keeps each page's JavaScript (Brotli) within its budget:
// most pages carry only Datastar and the panel scripts; logs adds xterm.js, and
// servers adds its metrics script, which fetches uPlot only once a chart has
// samples to draw.
func TestPageScriptBudget(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	names := map[string]string{}
	for _, n := range static.Names() {
		names[strings.TrimPrefix(static.Path(n), static.Prefix)] = n
	}
	script := regexp.MustCompile(`<script[^>]+src="/assets/([^"]+)"`)
	for path, budget := range map[string]int{
		"/": 20_000, "/apps": 20_000, "/apps/new": 20_000, "/apps/dev-app-api": 20_000, "/apps/dev-app-api/deployments": 20_000,
		"/apps/dev-app-api/settings": 20_000, "/settings": 20_000, "/settings/github": 20_000, "/settings/audit": 20_000,
		"/servers": 40_000, "/apps/dev-app-api/logs": 80_000,
	} {
		res := s.get(path)
		total := 0
		for _, m := range script.FindAllStringSubmatch(res.body, -1) {
			total += static.Size(names[m[1]], ".br")
		}
		t.Logf("%-32s %6d B", path, total)
		if total == 0 || total > budget {
			t.Fatalf("%s loads %d B of JavaScript, budget %d B", path, total, budget)
		}
	}
}
