package agent

import (
	"context"
	"encoding/json"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/host"
	bk "github.com/moby/buildkit/client"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"io"
	"sync"
	"time"
)

func (d *DockerEngine) Metrics(ctx context.Context, data string) *agentv1.Metrics {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out := host.MetricsAt(ctx, data)
	out.CacheUsed = d.buildCacheUsed(ctx)
	list, e := d.Docker.ContainerList(ctx, client.ContainerListOptions{Limit: 256, Filters: client.Filters{}.Add("label", "nelcota.managed=true")})
	if e != nil {
		return out
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	slots := make(chan struct{}, 4)
	seen := map[string]bool{}
	for _, c := range list.Items {
		if c.Labels["nelcota.app"] == "" {
			continue
		}
		seen[c.ID] = true
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			continue
		}
		wg.Go(func() {
			defer func() { <-slots }()
			r, e := d.Docker.ContainerStats(ctx, c.ID, client.ContainerStatsOptions{})
			if e != nil {
				return
			}
			defer r.Body.Close()
			var stats container.StatsResponse
			if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&stats) != nil {
				return
			}
			d.statsMu.Lock()
			if d.previousStats == nil {
				d.previousStats = map[string]container.CPUStats{}
			}
			previous := d.previousStats[c.ID]
			d.previousStats[c.ID] = stats.CPUStats
			d.statsMu.Unlock()
			m := containerMetrics(c.Labels["nelcota.app"], c.ID, stats, previous)
			mu.Lock()
			out.Containers = append(out.Containers, m)
			mu.Unlock()
		})
	}
	wg.Wait()
	d.statsMu.Lock()
	for id := range d.previousStats {
		if !seen[id] {
			delete(d.previousStats, id)
		}
	}
	d.statsMu.Unlock()
	return out
}

// buildCacheUsed reports BuildKit's cache size, refreshed at most once a minute
// because disk usage walks every record.
func (d *DockerEngine) buildCacheUsed(ctx context.Context) uint64 {
	if d.BuildKit == nil {
		return 0
	}
	d.statsMu.Lock()
	fresh := time.Since(d.cacheCheckedAt) < time.Minute
	used := d.cacheUsed
	d.statsMu.Unlock()
	if fresh {
		return used
	}
	records, e := d.BuildKit.DiskUsage(ctx)
	if e != nil {
		return used
	}
	used = cacheTotal(records)
	d.statsMu.Lock()
	d.cacheUsed, d.cacheCheckedAt = used, time.Now()
	d.statsMu.Unlock()
	return used
}

// cacheTotal sums record sizes, matching the total `buildx du` reports.
func cacheTotal(records []*bk.UsageInfo) uint64 {
	var total uint64
	for _, r := range records {
		if r != nil && r.Size > 0 {
			total += uint64(r.Size)
		}
	}
	return total
}
func containerMetrics(app, id string, s container.StatsResponse, previous container.CPUStats) *agentv1.ContainerMetrics {
	m := &agentv1.ContainerMetrics{AppId: app, ContainerId: id, MemoryUsed: s.MemoryStats.Usage, MemoryLimit: s.MemoryStats.Limit, Pids: s.PidsStats.Current}
	if previous.SystemUsage > 0 && s.CPUStats.SystemUsage > previous.SystemUsage && s.CPUStats.CPUUsage.TotalUsage >= previous.CPUUsage.TotalUsage {
		cores := s.CPUStats.OnlineCPUs
		if cores == 0 {
			cores = uint32(len(s.CPUStats.CPUUsage.PercpuUsage))
		}
		m.CpuPercent = 100 * float64(s.CPUStats.CPUUsage.TotalUsage-previous.CPUUsage.TotalUsage) / float64(s.CPUStats.SystemUsage-previous.SystemUsage) * float64(cores)
	}
	cache := s.MemoryStats.Stats["inactive_file"]
	if old := s.MemoryStats.Stats["total_inactive_file"]; old > 0 {
		cache = old
	}
	if cache < m.MemoryUsed {
		m.MemoryUsed -= cache
	}
	for _, n := range s.Networks {
		m.NetworkRx += n.RxBytes
		m.NetworkTx += n.TxBytes
	}
	return m
}
