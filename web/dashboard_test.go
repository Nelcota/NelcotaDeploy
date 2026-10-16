package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/web"
)

func TestHomePage(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, "Home", `data-init="@get(&#34;/ui/stream/dashboard&#34;`, `id="dashboard"`,
		// Setup checklist derived from data: passkey and GitHub still pending.
		"Get your first app online", "3 of 5 done", "Add a passkey to your account", "Connect GitHub",
		"Needs your attention", "Everything is running normally.",
		`id="app-row-dev-app-api"`, `href="/apps/dev-app-api"`, `data-state="live"`, ">Live<", "api.example.test", "bbbbbbb",
		`aria-label="Publish the latest version of api"`, "deploy?latest=1", `id="server-dev-server-api"`, "Waiting for metrics", "New app")
	member := e.member().get("/")
	mustNotContain(t, member.body, "New app", "Get your first app online")
	mustContain(t, member.body, `aria-label="Publish the latest version of api"`)
}

func TestHomeAttentionForFailedRelease(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings,error_code) VALUES('broken','dev-app-store',?,'Upgrade','Ana','push','failed',?,?,?,'{"clone":100,"build":900,"start":200}','health_no_response')`, "dead"+strings.Repeat("0", 36), now, now, now+5); err != nil {
		t.Fatal(err)
	}
	res := e.admin().get("/")
	mustContain(t, res.body, `id="attention-app-dev-app-store"`, "store didn&#39;t go live", "Stopped at the health check", "The previous version is still online.", `data-state="update_failed"`, "Update failed", "See why")
	mustNotContain(t, res.body, "Everything is running normally.")
}

func TestAppsListPage(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/apps")
	mustContain(t, res.body, "<h1 class=\"page-title\">Apps</h1>", "app-row-dev-app-blog", `aria-current="page"`)
}

func TestPublishLatestUsesBranchHead(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.post("/ui/apps/dev-app-api/deploy?latest=1", nil)
	mustContain(t, res.body, "Publishing api at")
	deploys, _ := e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api")
	if deploys[0].Status != "queued" || deploys[0].SHA == strings.Repeat("b", 40) || deploys[0].Message != "Latest commit on main" || deploys[0].Origin != "manual" || deploys[0].Author != "Development" {
		t.Fatal(deploys[0])
	}
	// Explicit SHA and clean build.
	sha := strings.Repeat("c", 40)
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {sha}, "clean": {"true"}}).body, "Clean build of api started.")
	deploys, _ = e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api")
	if deploys[0].SHA != sha || !deploys[0].Clean || deploys[0].Message != "Manual deployment" || deploys[1].Status != "cancelled" {
		t.Fatal(deploys[:2])
	}
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {"abc"}}).body, "Full SHA required")
	mustContain(t, s.post("/ui/apps/missing/deploy", nil).body, "Resource not found")
}

func TestPublishLatestWithoutGitHubRepublishes(t *testing.T) {
	e := newEnvWithout(t)
	res := e.admin().post("/ui/apps/dev-app-api/deploy?latest=1", nil)
	mustContain(t, res.body, "Publishing api again at bbbbbbb. Connect GitHub to publish new commits.")
}

func TestOverviewPage(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/apps/dev-app-api")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, `aria-current="page"`, ">Overview<", ">History<", "Online now", "Version <span class=\"mono\">bbbbbbb</span>", "Publish latest", "Publish a commit", `id="deploy-commit"`, "Recent releases", "Usage now", "Runs on", "Checking DNS…", "Check again", `data-ignore-morph`, `data-init="@get(&#34;/ui/stream/apps/dev-app-api/overview&#34;`)
	if res := s.get("/apps/nope"); res.code != http.StatusNotFound {
		t.Fatal(res.code)
	}
}

func TestOverviewExplainsFailure(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings,error_code) VALUES('broken','dev-app-api',?,'Upgrade','Ana','push','failed',?,?,?,'{"clone":100,"build":900,"start":200}','health_no_response')`, "dead"+strings.Repeat("0", 36), now, now, now+5); err != nil {
		t.Fatal(err)
	}
	if err := e.core.LogStore.Append(e.ctx, "broken", []byte("[start] listening on 0.0.0.0:3000\n[healthcheck] no response on port 8080\n")); err != nil {
		t.Fatal(err)
	}
	res := e.admin().get("/apps/dev-app-api")
	mustContain(t, res.body, "didn't go live. Your site is still running the previous version.",
		`data-state="fail"`, "Checking it responds", `data-state="done"`,
		"Your app didn&#39;t answer at / on port 8080 within 60 seconds.", "listens on port 8080 on all interfaces",
		"<mark>[healthcheck] no response on port 8080</mark>", "[start] listening on 0.0.0.0:3000",
		"Try again", "deploy?sha=dead", "Change health check", "Full log")
}

func TestCheckDNS(t *testing.T) {
	e := newEnv(t)
	res := e.admin().post("/ui/apps/dev-app-api/dns", nil)
	mustContain(t, res.body, `elements <ul id="dns-results"`, "api.example.test", "doesn't resolve yet")
}

func TestDashboardStream(t *testing.T) {
	old := *web.LiveInterval
	*web.LiveInterval = 50 * time.Millisecond
	defer func() { *web.LiveInterval = old }()
	e := newEnv(t)
	s := e.admin()
	w, stop := s.open("/ui/stream/dashboard")
	defer stop()
	waitFor(t, w, `"_conn":"live"`)
	mustContain(t, w.body(), `elements <div id="dashboard"`)
	sample, _ := json.Marshal(map[string]any{"server_id": "dev-server-api", "metrics": map[string]any{"cpu_percent": 42.5, "memory_used": 1 << 30, "memory_total": 4 << 30, "disk_used": 38 << 30, "disk_total": 40 << 30}})
	e.core.Hub.Publish("servers", "server.metrics", sample)
	waitFor(t, w, "42.5%")
	// A nearly full disk becomes an attention item without reloading.
	waitFor(t, w, "disk is 95% full")
	mustContain(t, w.body(), `elements <article id="server-dev-server-api"`, `elements <section id="attention"`, "Free up space")
	if res := s.post("/ui/apps/dev-app-blog/deploy?latest=1", nil); toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	waitFor(t, w, `data-state="publishing"`)
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "DELETE FROM sessions"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, w, "location.assign")
}

func TestOverviewStreamUsage(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	w, stop := s.open("/ui/stream/apps/dev-app-api/overview")
	defer stop()
	waitFor(t, w, `"_conn":"live"`)
	sample, _ := json.Marshal(map[string]any{"server_id": "dev-server-api", "metrics": map[string]any{"containers": []map[string]any{{"app_id": "dev-app-api", "cpu_percent": 7.5, "memory_used": 100 << 20, "memory_limit": 256 << 20}, {"app_id": "other", "cpu_percent": 99}}}})
	e.core.Hub.Publish("servers", "server.metrics", sample)
	body := waitFor(t, w, "7.5%")
	mustContain(t, body, `elements <section id="usage"`, "100.0 MiB", "256.0 MiB")
	mustNotContain(t, body, "99.0%")
}

func TestStreamRequiresSession(t *testing.T) {
	e := newEnv(t)
	if r := e.anon("/ui/stream/dashboard"); r.code != http.StatusUnauthorized {
		t.Fatal(r.code)
	}
}
