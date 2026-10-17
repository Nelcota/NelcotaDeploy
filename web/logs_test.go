package web_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestLogsPage(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/apps/dev-app-api/logs")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	// Default: newest deployment's build log, loaded by the browser from /api.
	mustContain(t, res.body, `data-mode="build"`, `data-topic="deploy/dev-deploy-api-success"`, `data-deployment="dev-deploy-api-success"`, `data-status="success"`, `role="log"`, `for="log-search"`, "Search logs", "Pause", "Follow", "Download", `value="runtime"`, "Build bbbbbbb · Published", `data-file="api-bbbbbbb-dev-deploy-api-success.log"`, "/assets/xterm.", "/assets/logs.", "Demo deployment", `title="Duration"`)
	// Log text is never inlined into the page.
	mustNotContain(t, res.body, "SHA verified")
	policy := res.header.Get("Content-Security-Policy")
	if !strings.Contains(policy, "style-src 'self' 'unsafe-inline'") || strings.Contains(policy, "script-src 'self' 'unsafe-inline'") || strings.Contains(policy, "unsafe-eval") {
		t.Fatal(policy)
	}
	res = s.get("/apps/dev-app-api/logs?deployment=runtime")
	mustContain(t, res.body, `data-mode="runtime"`, `data-topic="app/dev-app-api"`, "Clear", "streamed live and not stored")
	// A deployment of another app is not shown under this app.
	if res := s.get("/apps/dev-app-api/logs?deployment=dev-deploy-blog-success"); res.code != http.StatusNotFound {
		t.Fatal(res.code)
	}
	if res := s.get("/apps/dev-app-api/logs?deployment=missing"); res.code != http.StatusNotFound {
		t.Fatal(res.code)
	}
	// Other pages keep the strict style policy.
	if p := s.get("/").header.Get("Content-Security-Policy"); strings.Contains(p, "unsafe-inline") {
		t.Fatal(p)
	}
}

func TestLogsAPIUsedByPage(t *testing.T) {
	e := newEnv(t)
	res := e.member().get("/api/deployments/dev-deploy-api-success/logs")
	mustContain(t, res.body, "SHA verified", "version deployed")
}
