package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web"
)

func TestHomePage(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	// Nothing needs attention: a quiet line, no section heading.
	mustNotContain(t, res.body, "Needs your attention")
	mustContain(t, res.body, "Home", `data-init="@get(&#34;/ui/stream/dashboard&#34;`, `id="dashboard"`,
		// An app is live, so the checklist shrinks to one optional suggestion.
		`id="first-steps"`, "Suggested next step", "Add a passkey to your account", "/ui/first-steps/hide",
		"Everything is running normally.",
		`id="app-row-dev-app-api"`, `href="/apps/dev-app-api"`, `data-state="live"`, ">Live<", "api.example.test", "bbbbbbb",
		`aria-label="Publish the latest version of api"`, "deploy?latest=1", `id="server-dev-server-api"`, "Waiting for metrics", "New app")
	mustNotContain(t, res.body, "Get your first app online", "checkmark")
	member := e.member().get("/")
	mustNotContain(t, member.body, "New app", `id="first-steps"`)
	mustContain(t, member.body, `aria-label="Publish the latest version of api"`)
}

func TestFirstStepsChecklistUntilAnAppIsLive(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `UPDATE deployments SET status='failed' WHERE status='success'`); err != nil {
		t.Fatal(err)
	}
	res := s.get("/")
	mustContain(t, res.body, "Get your first app online", "2 of 5 done", "Connect GitHub", `class="step-number"`,
		"Done: Add a server · Create an app", "Publish your first app", "Hide setup suggestions")

	// Hiding is remembered for this person only.
	mustContain(t, s.post("/ui/first-steps/hide", nil).body, "selector #first-steps", "mode remove")
	mustNotContain(t, s.get("/").body, `id="first-steps"`, "Get your first app online")
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
	if deploys[0].Status != "queued" || deploys[0].SHA == strings.Repeat("b", 40) || deploys[0].Message != "Update the landing page" || deploys[0].Origin != "manual" || deploys[0].Author != "Development" {
		t.Fatal(deploys[0])
	}
	// Explicit SHA and clean build.
	sha := strings.Repeat("c", 40)
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {sha}, "clean": {"true"}}).body, "Clean build of api started.")
	deploys, _ = e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api")
	if deploys[0].SHA != sha || !deploys[0].Clean || deploys[0].Message != "Manual deployment" || deploys[1].Status != "cancelled" {
		t.Fatal(deploys[:2])
	}
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {"abc"}}).body, "Enter at least 7 characters of a commit SHA")
	mustContain(t, s.post("/ui/apps/missing/deploy", nil).body, "Resource not found")
}

// "Publish a commit" lists the branch's recent commits and accepts short SHAs.
func TestPublishACommit(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	mustContain(t, s.get("/apps/dev-app-api").body, "Recent commits on main", "Or enter a commit SHA", "/ui/apps/dev-app-api/commits")
	list := s.get("/ui/apps/dev-app-api/commits").body
	mustContain(t, list, `id="deploy-commit-list"`, `name="sha"`, "Update the landing page", "Fix the signup form", "Development")
	info, _ := service.DevRepos{}.Commits(withUser(e, "development-user"), service.RepoQuery{Repository: "https://github.com/example/api", Branch: "main"})
	pick := info[2]

	// A commit picked from the list.
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {pick.SHA}, "sha_input": {""}}).body, "Publishing api at "+pick.SHA[:7]+".")
	if deploys, _ := e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api"); deploys[0].Message != pick.Message {
		t.Fatal(deploys[0])
	}
	// A short SHA typed by hand wins over the list and is resolved to the full one.
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha": {info[0].SHA}, "sha_input": {info[3].SHA[:8]}}).body, "Publishing api at "+info[3].SHA[:7]+".")
	deploys, _ := e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api")
	if deploys[0].SHA != info[3].SHA || deploys[0].Message != info[3].Message {
		t.Fatal(deploys[0])
	}
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha_input": {""}}).body, "Choose a commit or enter its SHA.")
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha_input": {"abcdef0"}}).body, "No commit with that SHA was found in the repository")
}

// Without GitHub the dialog asks for the full SHA and says why.
func TestPublishACommitWithoutGitHub(t *testing.T) {
	e := newEnvWithout(t)
	s := e.admin()
	page := s.get("/apps/dev-app-api").body
	mustContain(t, page, "The full 40-character SHA. Connect GitHub to pick from recent commits.", `pattern="[0-9a-fA-F]{40}|[0-9a-fA-F]{64}"`)
	mustNotContain(t, page, "Recent commits on")
	mustContain(t, s.get("/ui/apps/dev-app-api/commits").body, "GitHub isn&#39;t connected.")
	mustContain(t, s.post("/ui/apps/dev-app-api/deploy", url.Values{"sha_input": {"abcdef0"}}).body, "Enter the full 40-character SHA. Connect GitHub to use a shorter one.")
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
	mustContain(t, res.body, `aria-current="page"`, ">Overview<", ">History<", "Online now", "Version <span class=\"mono\">bbbbbbb</span>", "Publish latest", "Publish a commit", `id="deploy-commit"`, "Recent deployments", "Usage now", "Runs on", "Checking DNS…", "Check again", `data-ignore-morph`, `data-init="@get(&#34;/ui/stream/apps/dev-app-api/overview&#34;`)
	// Shortcuts to this version's logs, recent rows that open their log, and
	// the server's status with readable limits.
	mustContain(t, res.body, "Live logs</a>", `href="/apps/dev-app-api/logs?deployment=runtime"`, "Build log</a>", `href="/apps/dev-app-api/logs?deployment=dev-deploy-api-success"`,
		`class="recent-row"`, "Demo deployment", `href="/servers#server-dev-server-api"`, `data-status="online"`, "Copies", "Limits per copy.")
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
		`data-state="failed"`, "Checking it responds", `data-state="done"`,
		"Your app didn&#39;t answer at / on port 8080 within 60 seconds.",
		"<mark>[healthcheck] no response on port 8080</mark>", "[start] listening on 0.0.0.0:3000",
		// The log names the real port, so switching to it is the main action.
		"Its log says it listens on port 3000, but the health check uses port 8080.",
		"Use port 3000 and publish", "/ui/deployments/broken/port?port=3000",
		"Try again", "deploy?sha=dead", "Change health check", "Full log")
	mustNotContain(t, res.body, "listens on port 8080 on all interfaces")
	// Members can try again but not change settings.
	mustNotContain(t, e.member().get("/apps/dev-app-api").body, "Use port 3000 and publish")

	s := e.admin()
	mustContain(t, s.post("/ui/deployments/broken/port?port=3000", nil).body, "Publishing api at dead000 on port 3000.")
	app, err := e.services().Apps.Get(withUser(e, "development-user"), "dev-app-api")
	if err != nil || app.Config.Port != 3000 {
		t.Fatal(app.Config.Port, err)
	}
	deploys, _ := e.services().Deploys.List(withUser(e, "development-user"), "dev-app-api")
	if deploys[0].Status != "queued" || !strings.HasPrefix(deploys[0].SHA, "dead") {
		t.Fatal(deploys[0])
	}
}

// Without a port in the log, the failure keeps the general advice.
func TestOverviewFailureWithoutPortHint(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings,error_code) VALUES('broken','dev-app-api',?,'Upgrade','Ana','push','failed',?,?,?,'{"clone":100,"build":900,"start":200}','health_no_response')`, "dead"+strings.Repeat("0", 36), now, now, now+5); err != nil {
		t.Fatal(err)
	}
	res := e.admin().get("/apps/dev-app-api")
	mustContain(t, res.body, "listens on port 8080 on all interfaces", "Try again")
	mustNotContain(t, res.body, "and publish")
}

// The overview and the history show the same progress for a deployment.
func TestStageProgressMatchesAcrossPages(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings,error_code) VALUES('broken','dev-app-api',?,'Upgrade','Ana','push','failed',?,?,?,'{"clone":100,"build":900,"start":200}','health_no_response')`, "dead"+strings.Repeat("0", 36), now, now, now+5); err != nil {
		t.Fatal(err)
	}
	stages := func(body, after string) string {
		t.Helper()
		i := strings.Index(body, after)
		if i < 0 {
			t.Fatalf("missing %s", after)
		}
		start := strings.Index(body[i:], `<ol class="stages"`)
		if start < 0 {
			t.Fatalf("no stages after %s", after)
		}
		rest := body[i+start:]
		return rest[:strings.Index(rest, "</ol>")]
	}
	overview := stages(e.admin().get("/apps/dev-app-api").body, `id="failure-title"`)
	history := stages(e.admin().get("/apps/dev-app-api/deployments").body, `id="deployment-broken"`)
	if overview != history {
		t.Fatalf("overview and history differ:\n%s\n%s", overview, history)
	}
	mustContain(t, overview, `data-state="failed"`, `data-state="done"`)
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
	if res := s.post("/ui/apps/dev-app-blog/deploy?latest=1", nil); toast(res.body) != "info" {
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
	// Meters: 7.5% of one CPU is 75 thousandths; 100 of 256 MiB is 390.
	mustContain(t, body, `elements <section id="usage"`, "100.0 MiB", "256.0 MiB", "of 1 CPU", `<progress class="meter" max="1000" value="75"`, `value="390"`)
	mustNotContain(t, body, "99.0%")
}

func TestStreamRequiresSession(t *testing.T) {
	e := newEnv(t)
	if r := e.anon("/ui/stream/dashboard"); r.code != http.StatusUnauthorized {
		t.Fatal(r.code)
	}
}
