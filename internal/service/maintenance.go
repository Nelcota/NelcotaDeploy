package service

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
)

// Automatic disk relief: when a server's disk is nearly full, the panel removes
// images that no container uses (the same safe cleanup as "Remove unused
// images"). The build cache is left alone; its own size limit already bounds it.
const (
	diskReliefPercent  = 85
	diskReliefInterval = time.Hour
)

// diskRelief remembers the last automatic cleanup per server, so a disk that
// stays full is not cleaned on every metrics sample.
type diskRelief struct {
	mu   sync.Mutex
	last map[string]time.Time
}

// due reports whether server may be cleaned now, and records it if so.
func (d *diskRelief) due(server string, now time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.last == nil {
		d.last = map[string]time.Time{}
	}
	if t, ok := d.last[server]; ok && now.Sub(t) < diskReliefInterval {
		return false
	}
	d.last[server] = now
	return true
}

func diskNearlyFull(m *agentv1.Metrics) bool {
	return m != nil && m.DiskTotal > 0 && m.DiskUsed*100 >= m.DiskTotal*diskReliefPercent
}

// relieveDisk removes unused images on a nearly full server. Failures are
// logged, not returned: metrics ingestion must not fail because of cleanup.
func (c *Core) relieveDisk(ctx context.Context, server string, m *agentv1.Metrics) {
	if c.Control == nil || !diskNearlyFull(m) || !c.disk.due(server, time.Now()) {
		return
	}
	ctx = systemContext(ctx)
	if e := c.mutate(ctx, func(tx *sql.Tx) error { return c.audit(ctx, tx, "server.prune.orphan_images.auto", server) }); e != nil {
		slog.Warn("automatic disk cleanup not recorded", "server", server, "err", e)
		return
	}
	if e := c.send(ctx, server, &agentv1.Command{Action: &agentv1.Command_Prune{Prune: &agentv1.Prune{Scope: agentv1.Prune_ORPHAN_IMAGES}}}); e != nil {
		slog.Warn("automatic disk cleanup not sent", "server", server, "err", e)
	}
}
