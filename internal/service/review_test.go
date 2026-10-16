package service

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
)

func waitForWriter(t *testing.T, db *sql.DB, before int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for db.Stats().WaitCount <= before {
		if time.Now().After(deadline) {
			t.Fatal("operation never waited for the writer")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCancelSeesAClaimCommittedWhileItWaits(t *testing.T) {
	c, ctx, app := fixture(t)
	s := &deploysService{c}
	d, err := s.Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if err != nil {
		t.Fatal(err)
	}
	dispatch := &operationDispatcher{}
	c.Control = dispatch
	tx, err := c.DB.Write.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	before := c.DB.Write.Stats().WaitCount
	done := make(chan error, 1)
	go func() { done <- s.Cancel(ctx, d.ID) }()
	waitForWriter(t, c.DB.Write, before)
	if _, err = tx.ExecContext(ctx, "UPDATE deployments SET status='building' WHERE id=?", d.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	if len(dispatch.commands) != 1 || dispatch.commands[0].GetCancel() == nil {
		t.Fatal("active build missed cancellation")
	}
}

func TestDeleteRechecksStoppedStateUnderTheWriter(t *testing.T) {
	c, ctx, app := fixture(t)
	app.Config.Stopped = true
	if _, err := (&appsService{c}).Update(ctx, app.ID, AppInput{app.Name, app.ServerID, app.Repository, app.Branch, app.Config}); err != nil {
		t.Fatal(err)
	}
	tx, err := c.DB.Write.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	before := c.DB.Write.Stats().WaitCount
	done := make(chan error, 1)
	go func() { done <- (&appsService{c}).Delete(ctx, app.ID, true) }()
	waitForWriter(t, c.DB.Write, before)
	app.Config.Stopped = false
	config, _ := json.Marshal(app.Config)
	if _, err = tx.ExecContext(ctx, "UPDATE apps SET config=? WHERE id=?", string(config), app.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-done; !Is(err, Conflict) {
		t.Fatalf("deleted concurrently started app: %v", err)
	}
	if _, err = (&appsService{c}).Get(ctx, app.ID); err != nil {
		t.Fatal(err)
	}
}

func TestTerminalEventCannotOverwriteACommittedSuccess(t *testing.T) {
	c, ctx, app := fixture(t)
	d, err := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.DB.Write.ExecContext(ctx, "UPDATE deployments SET status='starting' WHERE id=?", d.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := c.DB.Write.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	before := c.DB.Write.Stats().WaitCount
	done := make(chan error, 1)
	go func() {
		done <- c.AgentEvent(ctx, transport.Peer{ID: app.ServerID}, &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{AppId: app.ID, DeployId: d.ID, Status: "failed"}}})
	}()
	waitForWriter(t, c.DB.Write, before)
	if _, err = tx.ExecContext(ctx, "UPDATE deployments SET status='success' WHERE id=?", d.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	final, err := (&deploysService{c}).Get(ctx, d.ID)
	if err != nil || final.Status != "success" {
		t.Fatalf("terminal status regressed: %#v %v", final, err)
	}
}

func TestGlobalStreamsEnforceTheirDomainScopes(t *testing.T) {
	c, ctx, _ := fixture(t)
	for topic, scope := range map[string]string{"apps": "apps:read", "servers": "servers:read", "deployments": "deploys:read"} {
		p := Principal{ID: "member", Role: "member", Scopes: []string{"logs:read"}}
		if sub, err := (&logsService{c}).Subscribe(WithPrincipal(ctx, p), topic); !Is(err, Forbidden) {
			if err == nil {
				sub.Cancel()
			}
			t.Fatalf("scope bypass on %s: %v", topic, err)
		}
		p.Scopes = append(p.Scopes, scope)
		sub, err := (&logsService{c}).Subscribe(WithPrincipal(ctx, p), topic)
		if err != nil {
			t.Fatal(err)
		}
		sub.Cancel()
	}
}

func TestActionPreservesConcurrentConfigurationAndRestartDoesNotRedeploy(t *testing.T) {
	c, ctx, app := fixture(t)
	tx, err := c.DB.Write.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	before := c.DB.Write.Stats().WaitCount
	done := make(chan error, 1)
	go func() { done <- (&appsService{c}).Action(ctx, app.ID, "stop", 0, true) }()
	waitForWriter(t, c.DB.Write, before)
	if _, err = tx.ExecContext(ctx, "UPDATE apps SET branch='release' WHERE id=?", app.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	updated, err := (&appsService{c}).Get(ctx, app.ID)
	if err != nil || updated.Branch != "release" || !updated.Config.Stopped {
		t.Fatalf("action overwrote config: %#v %v", updated, err)
	}
	dispatch := &operationDispatcher{}
	c.Control = dispatch
	if err = (&appsService{c}).Action(ctx, app.ID, "restart", 0, false); !Is(err, Conflict) {
		t.Fatal("restart unexpectedly started a stopped application", err)
	}
	if err = (&appsService{c}).Action(ctx, app.ID, "start", 0, false); err != nil {
		t.Fatal(err)
	}
	updated, err = (&appsService{c}).Get(ctx, app.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = (&appsService{c}).Action(ctx, app.ID, "restart", 0, false); err != nil {
		t.Fatal(err)
	}
	after, err := (&appsService{c}).Get(ctx, app.ID)
	if err != nil || after.Revision != updated.Revision || len(dispatch.commands) != 1 || dispatch.commands[0].GetRestart() == nil {
		t.Fatal("restart also requested a rolling config deployment", err)
	}
}
