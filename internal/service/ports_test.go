package service

import (
	"strings"
	"testing"
)

func TestPortFromLog(t *testing.T) {
	for log, want := range map[string]uint32{
		"[start] listening on 0.0.0.0:3000\n[healthcheck] no response on port 8080 at / within the timeout\n": 3000,
		"[app] Server running at http://localhost:5000/\n":                                                    5000,
		"[app] Listening on port 4000\n[app] listening on [::]:4001\n":                                        4001,
		"[app] INFO Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)\n":                        8000,
		"[healthcheck] no response on port 8080\n":                                                            0,
		"[app] connected to db:5432\n":                                                                        0,
		"[app] started at 12:30:45\n":                                                                         0,
	} {
		if got := portFromLog([]byte(log)); got != want {
			t.Errorf("%q: %d, want %d", log, got, want)
		}
	}
}

func TestPublishOnPort(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &deploysService{c}
	d, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("d", 40), Message: "Upgrade"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e := s.PublishOnPort(ctx, d.ID, 3000); !Is(e, Conflict) {
		t.Fatal("a queued deployment was republished", e)
	}
	if _, e := c.DB.Write.ExecContext(ctx, "UPDATE deployments SET status='failed',error_code='health_no_response' WHERE id=?", d.ID); e != nil {
		t.Fatal(e)
	}
	if e := c.LogStore.Append(ctx, d.ID, []byte("[app] listening on 0.0.0.0:3000\n[healthcheck] no response on port 8080\n")); e != nil {
		t.Fatal(e)
	}
	if p, e := s.SuggestedPort(ctx, d.ID); e != nil || p != 3000 {
		t.Fatal(p, e)
	}
	member := WithPrincipal(ctx, Principal{ID: "member", Role: "member"})
	if p, e := s.SuggestedPort(member, d.ID); e != nil || p != 3000 {
		t.Fatal(p, e)
	}
	if _, e := s.PublishOnPort(member, d.ID, 3000); !Is(e, Forbidden) {
		t.Fatal("a member changed the port", e)
	}
	if _, e := s.PublishOnPort(ctx, d.ID, 0); !Is(e, Validation) {
		t.Fatal("port 0 accepted", e)
	}
	next, e := s.PublishOnPort(ctx, d.ID, 3000)
	if e != nil || next.Status != "queued" || next.SHA != d.SHA || next.Message != "Upgrade" || next.Origin != "manual" {
		t.Fatal(next, e)
	}
	app, _ := (&appsService{c}).Get(ctx, a.ID)
	if app.Config.Port != 3000 || app.Revision != a.Revision+1 {
		t.Fatal(app.Config.Port, app.Revision)
	}
	// The port now matches, so nothing more is suggested.
	if p, _ := s.SuggestedPort(ctx, d.ID); p != 0 {
		t.Fatal(p)
	}
	var audited int
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE (action='app.port' AND target=?) OR (action='deploy.enqueue' AND target=?)", a.ID, next.ID).Scan(&audited); e != nil || audited != 2 {
		t.Fatal(audited, e)
	}
}
