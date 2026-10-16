package web_test

import (
	"strings"
	"testing"
	"time"
)

func TestRailHasNavigationShortcutsAndAccountMenu(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/apps")
	mustContain(t, res.body, `aria-keyshortcuts="g h"`, `aria-keyshortcuts="g a"`, `aria-keyshortcuts="g s"`, `aria-keyshortcuts="g c"`, `data-shortcut="G H"`,
		`class="menu"`, `aria-label="Account menu"`, "dev@localhost", "My account", "data-logout")
	// Nothing needs attention in the seeded data.
	mustNotContain(t, res.body, "data-alert", "(needs attention)")
}

func TestRailMarksWhatNeedsAttention(t *testing.T) {
	e := newEnv(t)
	now := time.Now().Unix()
	if _, err := e.core.DB.Write.ExecContext(e.ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at,timings,error_code) VALUES('broken','dev-app-store',?,'Upgrade','Ana','push','failed',?,?,?,'{}','build_failed')`, "dead"+strings.Repeat("0", 36), now, now, now+5); err != nil {
		t.Fatal(err)
	}
	body := e.admin().get("/servers").body
	home := body[strings.Index(body, `href="/"`):strings.Index(body, `href="/apps"`)]
	mustContain(t, home, "data-alert", "(needs attention)")
	servers := body[strings.Index(body, `href="/servers"`):strings.Index(body, `href="/settings"`)]
	mustNotContain(t, servers, "data-alert")

	if _, err := e.core.DB.Write.ExecContext(e.ctx, `UPDATE servers SET status='offline' WHERE id='dev-server-api'`); err != nil {
		t.Fatal(err)
	}
	body = e.admin().get("/apps").body
	servers = body[strings.Index(body, `href="/servers"`):strings.Index(body, `href="/settings"`)]
	mustContain(t, servers, "data-alert")
}
