package service

import (
	"context"
	"errors"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"github.com/nelcota/nelcota-deploy/internal/updater"
	"strings"
	"testing"
	"time"
)

type operationDispatcher struct {
	commands []*agentv1.Command
	servers  []string
}

func (d *operationDispatcher) Send(_ context.Context, server string, c *agentv1.Command) error {
	d.commands = append(d.commands, c)
	d.servers = append(d.servers, server)
	return nil
}
func TestOrderedUpdatesPauseDeploysWaitForVersionAndPanelLast(t *testing.T) {
	c, ctx, a := fixture(t)
	p, _ := CurrentUser(ctx)
	p.TwoFactorAt = time.Now().Unix()
	ctx = WithPrincipal(ctx, p)
	invite, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "second", WireGuardIP: "10.77.0.3"})
	if e != nil {
		t.Fatal(e)
	}
	_, _ = c.DB.Write.ExecContext(ctx, "UPDATE servers SET status='online',agent_ready=1,heartbeat_at=?,agent_version='v1.0.0'", time.Now().Unix())
	dispatcher := &operationDispatcher{}
	c.Control = dispatcher
	panelRequested := false
	s := &OperationsService{Core: c, Version: "v1.0.0", VerifyRelease: func(context.Context, string) error { return nil }, QueuePanel: func(string, string) error { panelRequested = true; return nil }}
	jobs, e := s.Update(ctx, "v1.1.0")
	if e != nil || len(jobs) != 3 || jobs[2].Target != "panel" {
		t.Fatal(jobs, e)
	}
	if _, e = s.Update(ctx, "v1.2.0"); !Is(e, Conflict) {
		t.Fatal("parallel rollout allowed", e)
	}
	if e = s.step(ctx); e != nil {
		t.Fatal(e)
	}
	if len(dispatcher.commands) != 1 || dispatcher.commands[0].GetUpdate() == nil {
		t.Fatal(dispatcher.commands)
	}
	// A new queued deploy on the updating server cannot be claimed.
	app := a
	if jobs[0].Target == invite.ServerID {
		app, e = (&appsService{c}).Create(ctx, AppInput{Name: "second-app", ServerID: invite.ServerID, Repository: "https://github.com/example/repo", Branch: "main"})
		if e != nil {
			t.Fatal(e)
		}
	}
	_, e = (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.Claim(ctx); !Is(e, NotFound) {
		t.Fatal("deployment claimed while update waiting", e)
	}
	if e = s.step(ctx); e != nil || len(dispatcher.commands) != 1 || panelRequested {
		t.Fatal("advanced before heartbeat", e)
	}
	// Version alone must not finish the rollout before helper confirmation.
	if e = c.AgentEvent(ctx, transport.Peer{ID: jobs[0].Target}, &agentv1.Event{Payload: &agentv1.Event_Heartbeat{Heartbeat: &agentv1.Heartbeat{Ready: true, Version: "v1.1.0"}}}); e != nil {
		t.Fatal(e)
	}
	if e = s.step(ctx); e != nil || len(dispatcher.commands) != 1 {
		t.Fatal("advanced before helper confirmation", e)
	}
	for i := 0; i < 2; i++ {
		id := jobs[i].Target
		if e = c.AgentEvent(ctx, transport.Peer{ID: id}, &agentv1.Event{Payload: &agentv1.Event_Heartbeat{Heartbeat: &agentv1.Heartbeat{Ready: true, Version: "v1.1.0", UpdateResult: &agentv1.OperationResult{Id: jobs[i].ID, Status: "applied"}}}}); e != nil {
			t.Fatal(e)
		}
		if e = s.step(ctx); e != nil {
			t.Fatal(e)
		}
		if e = s.step(ctx); e != nil {
			t.Fatal(e)
		}
	}
	if !panelRequested || len(dispatcher.commands) != 2 {
		t.Fatal("panel order", panelRequested, len(dispatcher.commands))
	}
	s.Version = "v1.1.0"
	if e = s.step(ctx); e != nil {
		t.Fatal(e)
	}
	list, e := s.List(ctx)
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range list {
		if o.Status != "applied" {
			t.Fatal(o)
		}
	}
}
func TestOperationsAuthorizationBackupRetryAndStopOnFailure(t *testing.T) {
	c, ctx, _ := fixture(t)
	p, _ := CurrentUser(ctx)
	s := &OperationsService{Core: c, Version: "v1.0.0", VerifyRelease: func(context.Context, string) error { return nil }, QueuePanel: func(string, string) error { return nil }, CreateBackup: func(context.Context, string) error { return nil }}
	if _, e := s.Backup(ctx); !Is(e, Forbidden) {
		t.Fatal(e)
	}
	p.TwoFactorAt = time.Now().Unix()
	p.Scopes = []string{"settings:write"}
	if _, e := s.Backup(WithPrincipal(ctx, p)); !Is(e, Forbidden) {
		t.Fatal("API token requested backup", e)
	}
	p.Scopes = nil
	ctx = WithPrincipal(ctx, p)
	o, e := s.Backup(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Backup(ctx); !Is(e, Conflict) {
		t.Fatal(e)
	}
	if e = s.step(ctx); e != nil {
		t.Fatal(e)
	}
	list, _ := s.List(ctx)
	if list[0].Status != "applied" {
		t.Fatal(list)
	}
	jobs, e := s.Update(ctx, "v1.1.0")
	if e != nil {
		t.Fatal(e)
	}
	c.Control = &operationDispatcher{}
	if e = s.step(ctx); e != nil {
		t.Fatal(e)
	}
	if e = c.operationResult(ctx, jobs[0].Target, &agentv1.OperationResult{Id: jobs[0].ID, Status: "failed"}); e != nil {
		t.Fatal(e)
	}
	list, _ = s.List(ctx)
	if list[0].Status != "cancelled" || list[1].Status != "failed" {
		t.Fatal(list)
	}
	// Failure to create a manual snapshot is durable and does not expose errors.
	s.CreateBackup = func(context.Context, string) error { return errors.New("private path") }
	o, e = s.Backup(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.step(ctx); e != nil {
		t.Fatal(e)
	}
	list, _ = s.List(ctx)
	if list[0].ID != o.ID || list[0].ErrorCode != "backup_failed" {
		t.Fatal(list)
	}
}

func TestAgentCLIReservesMaintenanceBeforeHelperStarts(t *testing.T) {
	c, ctx, a := fixture(t)
	_, _ = c.DB.Write.ExecContext(ctx, "UPDATE servers SET fingerprint='known',agent_version='v1.0.0' WHERE id=?", a.ServerID)
	request := updater.Request{ID: "local-agent-update", Version: "v1.1.0"}
	peer := transport.Peer{ID: a.ServerID, Fingerprint: "wrong"}
	if e := c.PrepareAgentUpdate(ctx, peer, request); !Is(e, Forbidden) {
		t.Fatal(e)
	}
	peer.Fingerprint = "known"
	if e := c.PrepareAgentUpdate(ctx, peer, request); e != nil {
		t.Fatal(e)
	}
	if e := c.PrepareAgentUpdate(ctx, peer, request); e != nil {
		t.Fatal("request retry", e)
	}
	_, e := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.Claim(ctx); !Is(e, NotFound) {
		t.Fatal("new build raced CLI update", e)
	}
}

func TestQueuedUpdateDrainsWithoutAllowingNewBuildClaims(t *testing.T) {
	c, ctx, a := fixture(t)
	p, _ := CurrentUser(ctx)
	p.TwoFactorAt = time.Now().Unix()
	ctx = WithPrincipal(ctx, p)
	if _, e := (&serversService{c}).UpdateLimits(ctx, a.ServerID, ServerLimitsInput{BuildLimit: 2, CacheBytes: 1 << 30}); e != nil {
		t.Fatal(e)
	}
	_, e := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.Claim(ctx); e != nil {
		t.Fatal(e)
	}
	second, e := (&appsService{c}).Create(ctx, AppInput{Name: "second", ServerID: a.ServerID, Repository: "https://github.com/example/second", Branch: "main"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: second.ID, SHA: strings.Repeat("b", 40)})
	if e != nil {
		t.Fatal(e)
	}
	ops := &OperationsService{Core: c, Version: "v1.0.0", VerifyRelease: func(context.Context, string) error { return nil }, QueuePanel: func(string, string) error { return nil }}
	if _, e = ops.Update(ctx, "v1.1.0"); e != nil {
		t.Fatal(e)
	}
	if _, e = c.Claim(ctx); !Is(e, NotFound) {
		t.Fatal("queued maintenance did not drain existing work", e)
	}
}
