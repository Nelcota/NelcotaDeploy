package web_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web"
)

func (e *env) services() service.Services { return e.core.Services(e.auth) }

func TestDeploymentsPage(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings) VALUES('newer','dev-app-api',?,'Fix login','Ana','push','success',?,?,?,'{"clone":1200,"build":8000,"start":300,"healthcheck":900,"route":40}')`, strings.Repeat("d", 40), now-60, now-60, now-48); err != nil {
		t.Fatal(err)
	}
	res := e.admin().get("/apps/dev-app-api/deployments")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body,
		"Deployment history", `id="deployment-newer"`, "Fix login", "Ana", "ddddddd", "Online now",
		"1.2 s", "8.0 s", "300 ms", "40 ms", "Getting code", "Checking it responds", `aria-label="Stage durations"`,
		`href="/apps/dev-app-api/logs?deployment=newer"`,
		// The older success can be rolled back; the running one cannot.
		`id="rollback-dev-deploy-api-success"`, "Restore version bbbbbbb?", "goes live after its health check passes.",
		"Publish latest", "Publish a commit", "Build without cache", `id="confirm-clean"`,
		`data-init="@get(&#34;/ui/stream/apps/dev-app-api/deployments&#34;`, `aria-current="page"`, "https://github.com/example/api")
	mustNotContain(t, res.body, `id="rollback-newer"`, `id="cancel-`)
	if res := e.admin().get("/apps/nope/deployments"); res.code != http.StatusNotFound {
		t.Fatal(res.code)
	}
}

func TestCancelAndRollback(t *testing.T) {
	e := newEnv(t)
	s := e.member()
	if res := s.post("/ui/apps/dev-app-store/deploy", nil); toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	list, _ := e.services().Deploys.List(withUser(e, "development-user"), "dev-app-store")
	queued := list[0]
	page := s.get("/apps/dev-app-store/deployments")
	mustContain(t, page.body, `id="cancel-`+queued.ID+`"`, "Waiting for a build slot", "Cancel this deployment?")
	res := s.post("/ui/deployments/"+queued.ID+"/cancel", nil)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	d, _ := e.services().Deploys.Get(withUser(e, "development-user"), queued.ID)
	if d.Status != "cancelled" {
		t.Fatal(d.Status)
	}
	res = s.post("/ui/deployments/"+queued.ID+"/cancel", nil)
	mustContain(t, res.body, "Deployment already finished")
	res = s.post("/ui/deployments/dev-deploy-store-success/rollback", nil)
	mustContain(t, res.body, "Restoring version aaaaaaa.")
	list, _ = e.services().Deploys.List(withUser(e, "development-user"), "dev-app-store")
	if list[0].Origin != "rollback" || list[0].SHA != strings.Repeat("a", 40) || list[0].Status != "queued" {
		t.Fatal(list[0])
	}
	if res := s.post("/ui/deployments/missing/rollback", nil); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
}

func TestDeploymentsStreamFiltersApp(t *testing.T) {
	oldRefresh := *web.RefreshInterval
	*web.RefreshInterval = 20 * time.Millisecond
	defer func() { *web.RefreshInterval = oldRefresh }()
	e := newEnv(t)
	s := e.admin()
	w, stop := s.open("/ui/stream/apps/dev-app-api/deployments")
	defer stop()
	first := waitFor(t, w, `"_conn":"live"`)
	if strings.Count(first, `elements <div id="deployments"`) != 1 {
		t.Fatal(first)
	}
	// Another app's deployment does not re-render this table.
	s.post("/ui/apps/dev-app-blog/deploy", nil)
	time.Sleep(100 * time.Millisecond)
	if n := strings.Count(w.body(), `elements <div id="deployments"`); n != 1 {
		t.Fatal("re-rendered for another app", n)
	}
	s.post("/ui/apps/dev-app-api/deploy", nil)
	waitFor(t, w, `data-deployment-status="queued"`)
	// While a deployment is active the table refreshes periodically for stage timings.
	before := strings.Count(w.body(), `elements <div id="deployments"`)
	time.Sleep(150 * time.Millisecond)
	if after := strings.Count(w.body(), `elements <div id="deployments"`); after <= before {
		t.Fatal("no periodic refresh while active", before, after)
	}
}
