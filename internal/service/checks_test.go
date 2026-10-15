package service

import (
	"context"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type checkFake struct{ calls atomic.Int64 }

func (c *checkFake) Token(context.Context, int64) (string, error) { return "", nil }
func (c *checkFake) Check(context.Context, string, string, string, int64) (int64, error) {
	c.calls.Add(1)
	return 7, nil
}
func TestCheckOutboxDoesNotBlockAgentEvent(t *testing.T) {
	c, ctx, app := fixture(t)
	github := &checkFake{}
	c.GitHub = github
	d, e := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.Claim(ctx); e != nil {
		t.Fatal(e)
	}
	for _, status := range []string{"starting", "success"} {
		if e = c.AgentEvent(ctx, transport.Peer{ID: app.ServerID}, &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: d.ID, AppId: app.ID, Status: status}}}); e != nil {
			t.Fatal(e)
		}
	}
	if github.calls.Load() != 0 {
		t.Fatal("agent event called GitHub synchronously")
	}
	var status string
	if e = c.DB.Read.QueryRowContext(ctx, "SELECT desired_status FROM check_jobs WHERE deployment_id=?", d.ID).Scan(&status); e != nil || status != "success" {
		t.Fatal(status, e)
	}
	workerCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- c.RunChecks(workerCtx) }()
	timer := time.NewTimer(3 * time.Second)
	tick := time.NewTicker(20 * time.Millisecond)
	defer timer.Stop()
	defer tick.Stop()
	defer func() { cancel(); <-done }()
	for {
		select {
		case <-timer.C:
			t.Fatal("outbox was not processed")
		case <-tick.C:
			var checkID int64
			if e = c.DB.Read.QueryRowContext(ctx, "SELECT check_id FROM deployments WHERE id=?", d.ID).Scan(&checkID); e != nil {
				t.Fatal(e)
			}
			if checkID == 7 {
				return
			}
		}
	}
}
