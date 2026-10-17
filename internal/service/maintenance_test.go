package service

import (
	"context"
	"sync"
	"testing"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
)

type recordingDispatcher struct {
	mu       sync.Mutex
	commands []*agentv1.Command
}

func (r *recordingDispatcher) Send(_ context.Context, _ string, c *agentv1.Command) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.commands = append(r.commands, c)
	return nil
}

func (r *recordingDispatcher) prunes() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, c := range r.commands {
		if p := c.GetPrune(); p != nil && p.Scope == agentv1.Prune_ORPHAN_IMAGES {
			n++
		}
	}
	return n
}

func TestFullDiskRemovesUnusedImagesAtMostHourly(t *testing.T) {
	c, ctx, a := fixture(t)
	d := &recordingDispatcher{}
	c.Control = d
	sample := func(used uint64) {
		t.Helper()
		ev := &agentv1.Event{Payload: &agentv1.Event_Metrics{Metrics: &agentv1.Metrics{DiskUsed: used, DiskTotal: 100}}}
		if e := c.AgentEvent(ctx, transport.Peer{ID: a.ServerID}, ev); e != nil {
			t.Fatal(e)
		}
	}
	sample(84)
	if d.prunes() != 0 {
		t.Fatal("cleaned a disk below the threshold")
	}
	sample(85)
	sample(99)
	if d.prunes() != 1 {
		t.Fatal("expected one cleanup per interval, got", d.prunes())
	}
	var audited int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE action='server.prune.orphan_images.auto' AND target=? AND user_id='system'", a.ServerID).Scan(&audited)
	if audited != 1 {
		t.Fatal("cleanup not audited")
	}
	// After the interval it may run again.
	c.disk.last[a.ServerID] = time.Now().Add(-diskReliefInterval - time.Second)
	sample(90)
	if d.prunes() != 2 {
		t.Fatal("no cleanup after the interval")
	}
}
