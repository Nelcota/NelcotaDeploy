package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
)

// Simulated metrics must decode like real agent samples and vary over time.
func TestDevMetricsShape(t *testing.T) {
	apps := []dbgen.App{{ID: "a", ServerID: "s1"}, {ID: "b", ServerID: "s2"}}
	decode := func(at time.Time) *agentv1.Metrics {
		b, err := json.Marshal(devMetrics(at, 0, "s1", apps))
		if err != nil {
			t.Fatal(err)
		}
		var m agentv1.Metrics
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		return &m
	}
	now := time.Unix(1_000_000, 0)
	a, b := decode(now), decode(now.Add(45*time.Second))
	if a.CpuPercent == b.CpuPercent || a.MemoryUsed == b.MemoryUsed {
		t.Fatal("metrics do not vary", a, b)
	}
	if a.MemoryTotal != 4<<30 || a.MemoryUsed <= 0 || a.MemoryUsed >= a.MemoryTotal || a.DiskUsed >= a.DiskTotal || a.CpuPercent < 0 || a.CpuPercent > 100 {
		t.Fatal(a)
	}
	if len(a.Containers) != 1 || a.Containers[0].AppId != "a" || a.Containers[0].MemoryUsed >= a.Containers[0].MemoryLimit {
		t.Fatal(a.Containers)
	}
}

func TestFailureCode(t *testing.T) {
	for in, want := range map[string]string{"health_no_response": "health_no_response", "health_status_502": "health_status_502", "": "deployment_failed", "Bad Code": "deployment_failed", "x;drop": "deployment_failed", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": "deployment_failed"} {
		if got := failureCode(in); got != want {
			t.Fatal(in, got)
		}
	}
}

func TestAgentFailureCodeIsStored(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &deploysService{c}
	d, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e := c.Claim(ctx); e != nil {
		t.Fatal(e)
	}
	for _, code := range []string{"health_no_response", "Not A Code"} {
		if _, e := c.DB.Write.ExecContext(ctx, "UPDATE deployments SET status='building',error_code='' WHERE id=?", d.ID); e != nil {
			t.Fatal(e)
		}
		ev := &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: d.ID, AppId: a.ID, Status: "failed", ErrorCode: code}}}
		if e := c.AgentEvent(ctx, transport.Peer{ID: a.ServerID}, ev); e != nil {
			t.Fatal(e)
		}
		got, _ := s.Get(ctx, d.ID)
		if got.Status != "failed" || got.ErrorCode != failureCode(code) {
			t.Fatal(code, got.Status, got.ErrorCode)
		}
	}
}

func TestDevSimulationStagesAndFailure(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &deploysService{c}
	d := NewDevDispatcher(c, ctx)
	for _, row := range []struct {
		sha, status, code string
		stages            int
	}{{strings.Repeat("a", 40), "success", "", 5}, {"dead" + strings.Repeat("0", 36), "failed", "health_no_response", 3}} {
		dep, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: row.sha})
		if e != nil {
			t.Fatal(e)
		}
		if _, e := c.Claim(ctx); e != nil {
			t.Fatal(e)
		}
		d.simulate(ctx, ctx, a.ServerID, &agentv1.Deploy{DeployId: dep.ID, Sha: row.sha, App: &agentv1.AppConfig{AppId: a.ID}})
		got, _ := s.Get(ctx, dep.ID)
		if got.Status != row.status || got.ErrorCode != row.code || len(got.Timings) != row.stages {
			t.Fatalf("%s: %+v", row.sha, got)
		}
		text, _ := c.LogStore.Read(ctx, dep.ID, 1<<20)
		if !strings.Contains(string(text), "[clone] SHA verified") {
			t.Fatal(string(text))
		}
	}
}

func TestTransientFailureIsRetriedOnce(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &deploysService{c}
	fail := func(id, code string) {
		t.Helper()
		if _, e := c.DB.Write.ExecContext(ctx, "UPDATE deployments SET status='building' WHERE id=?", id); e != nil {
			t.Fatal(e)
		}
		ev := &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: id, AppId: a.ID, Status: "failed", ErrorCode: code}}}
		if e := c.AgentEvent(ctx, transport.Peer{ID: a.ServerID}, ev); e != nil {
			t.Fatal(e)
		}
	}
	list := func() []Deployment {
		d, e := s.List(ctx, a.ID)
		if e != nil {
			t.Fatal(e)
		}
		return d
	}
	first, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40), Message: "Ship", Author: "Ana", Origin: "manual"})
	if e != nil {
		t.Fatal(e)
	}
	fail(first.ID, "route_failed")
	d := list()
	if len(d) != 2 || d[0].RetryOf != first.ID || d[0].Status != "queued" || d[0].SHA != first.SHA || d[0].Message != "Ship" || d[0].Origin != "manual" {
		t.Fatalf("%+v", d)
	}
	// The retry failing again is not retried: two attempts at most.
	fail(d[0].ID, "route_failed")
	if len(list()) != 2 {
		t.Fatal("retried a retry")
	}
	// Build failures need a fix, so they are never retried.
	build, _ := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("b", 40)})
	fail(build.ID, "build_failed")
	if got := list(); len(got) != 3 || got[0].ID != build.ID {
		t.Fatal("retried a build failure")
	}
}
