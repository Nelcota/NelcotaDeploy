package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
)

const DevUserID = "development-user"

// Seed adds demonstration data. It is idempotent by id; rows that clash with
// other data under a different id fail loudly instead of being skipped.
func (c *Core) Seed(ctx context.Context) error {
	if e := c.seed(ctx); e != nil {
		return fmt.Errorf("development data could not be seeded; remove the development data directory (.local/dev by default) to reset it: %w", e)
	}
	return nil
}
func (c *Core) seed(ctx context.Context) error {
	ctx = systemContext(ctx)
	_, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,'admin',?) ON CONFLICT(id) DO NOTHING", DevUserID, "dev@localhost", "Development", time.Now().Unix())
	if e != nil {
		return e
	}
	for i, name := range []string{"store", "api", "blog"} {
		server := "dev-server-" + name
		app := "dev-app-" + name
		cfg := AppConfig{Domains: []string{name + ".example.test"}, MemoryBytes: 256 << 20, NanoCPUs: 1e9, Port: 8080, HealthPath: "/", HealthTimeout: 60, Replicas: 1, CacheEnabled: true, Dockerfile: "Dockerfile"}
		b, _ := json.Marshal(cfg)
		e = c.mutate(ctx, func(tx *sql.Tx) error {
			_, e := tx.ExecContext(ctx, `INSERT INTO servers(id,name,wireguard_ip,status,heartbeat_at,fingerprint,agent_ready)
				VALUES(?,?,?,'online',?,'development',1) ON CONFLICT(id) DO NOTHING`,
				server, "Server "+name, "10.77.0."+string(rune('2'+i)), time.Now().Unix())
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO apps(id,name,server_id,repository,branch,config) VALUES(?,?,?,?,'main',?) ON CONFLICT(id) DO NOTHING",
				app, name, server, "https://github.com/example/"+name, string(b))
			if e != nil {
				return e
			}
			for j, status := range []string{"success", "failed", "cancelled"} {
				queued := time.Now().Unix() - int64((j+1)*3600)
				_, e := tx.ExecContext(ctx, `INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at)
					VALUES(?,?,?,?,?,'push',?,?,?,?) ON CONFLICT(id) DO NOTHING`,
					"dev-deploy-"+name+"-"+status, app, strings.Repeat(string(rune('a'+i)), 40), "Demo deployment", "Development",
					status, queued, queued+1, queued+8)
				if e != nil {
					return e
				}
			}
			return nil
		})
		if e != nil {
			return e
		}
		id := "dev-deploy-" + name + "-success"
		b, e = c.LogStore.Read(ctx, id, 1)
		if e != nil {
			return e
		}
		if len(b) == 0 {
			if e = c.LogStore.Append(ctx, id, []byte("[clone] SHA verified\n[build] cache hit\n[healthcheck] healthy\n[route] version deployed\n")); e != nil {
				return e
			}
		}
	}
	return nil
}

// devMetrics simulates a host sample that varies smoothly over time, with one
// container per app on the server, shaped like agentv1.Metrics in JSON.
func devMetrics(now time.Time, index int, server string, apps []dbgen.App) map[string]any {
	phase := float64(now.UnixMilli()%180_000)/180_000*2*math.Pi + float64(index)
	wave := (1 + math.Sin(phase)) / 2
	containers := []map[string]any{}
	for _, a := range apps {
		if a.ServerID == server {
			containers = append(containers, map[string]any{
				"app_id": a.ID, "container_id": "dev-" + a.ID, "cpu_percent": 2 + 18*wave,
				"memory_used": int64(96<<20) + int64(wave*float64(64<<20)), "memory_limit": 256 << 20,
				"network_rx": now.Unix() * 1024, "network_tx": now.Unix() * 512, "pids": 12,
			})
		}
	}
	return map[string]any{
		"cpu_percent": 6 + 40*wave, "memory_used": int64(float64(4<<30) * (0.22 + 0.12*wave)), "memory_total": 4 << 30,
		"disk_used": int64(12<<30) + int64(index)<<30, "disk_total": 40 << 30,
		"network_rx": now.Unix() * 4096, "network_tx": now.Unix() * 2048,
		"containers": containers, "cache_used": int64(1<<30) + int64(index)*(512<<20),
	}
}
func (a *AuthService) DevelopmentSession(ctx context.Context) (LoginResult, error) {
	return a.issueSession(ctx, DevUserID)
}

type DevDispatcher struct {
	Core  *Core
	Ctx   context.Context
	queue chan devCommand
}
type devCommand struct {
	server  string
	command *agentv1.Command
}

func NewDevDispatcher(c *Core, ctx context.Context) *DevDispatcher {
	return &DevDispatcher{c, ctx, make(chan devCommand, 32)}
}
func (d *DevDispatcher) Send(ctx context.Context, server string, c *agentv1.Command) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case d.queue <- devCommand{server, c}:
		return nil
	}
}
func (d *DevDispatcher) Run(ctx context.Context) error {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	var mu sync.Mutex
	var wg sync.WaitGroup
	jobs := map[string]context.CancelFunc{}
	defer func() {
		mu.Lock()
		for _, cancel := range jobs {
			cancel()
		}
		mu.Unlock()
		wg.Wait()
	}()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case item := <-d.queue:
			if cancelCommand := item.command.GetCancel(); cancelCommand != nil {
				mu.Lock()
				if cancel := jobs[cancelCommand.DeployId]; cancel != nil {
					cancel()
				}
				mu.Unlock()
				continue
			}
			dep := item.command.GetDeploy()
			if dep == nil {
				continue
			}
			jobCtx, cancel := context.WithCancel(ctx)
			mu.Lock()
			jobs[dep.DeployId] = cancel
			mu.Unlock()
			wg.Go(func() {
				defer cancel()
				defer func() { mu.Lock(); delete(jobs, dep.DeployId); mu.Unlock() }()
				d.simulate(jobCtx, ctx, item.server, dep)
			})
		case <-tick.C:
			servers, _ := d.Core.DB.Queries.ListServers(ctx)
			apps, _ := d.Core.DB.Queries.ListApps(ctx)
			for i, s := range servers {
				_, _ = d.Core.DB.Write.ExecContext(ctx, "UPDATE servers SET heartbeat_at=?,status='online',agent_ready=1 WHERE id=?", time.Now().Unix(), s.ID)
				d.Core.publish("servers", "server.metrics", map[string]any{"server_id": s.ID, "metrics": devMetrics(time.Now(), i, s.ID, apps)})
			}
			for _, a := range apps {
				d.Core.publish("app/"+a.ID, "runtime.log", map[string]any{"line": "[dev] GET /health 200\n", "sequence": time.Now().Unix()})
			}
		}
	}
}

// devStages mirrors the real pipeline with short simulated durations.
var devStages = []struct {
	name     string
	duration time.Duration
	lines    []string
}{
	{"clone", 300 * time.Millisecond, []string{"[clone] fetching exact commit", "[clone] SHA verified"}},
	{"build", 900 * time.Millisecond, []string{"[build] resolving base image", "[build] cache hit: dependencies", "[build] image ready"}},
	{"start", 300 * time.Millisecond, []string{"[start] container started"}},
	{"healthcheck", 400 * time.Millisecond, []string{"[healthcheck] responded 200"}},
	{"route", 150 * time.Millisecond, []string{"[route] traffic switched"}},
}

// simulate walks one deployment through the pipeline. Commits whose SHA starts
// with "dead" fail the health check, so failure screens can be exercised: the
// simulated app listens on port 3000, so they pass once the app uses that port.
func (d *DevDispatcher) simulate(job, ctx context.Context, server string, dep *agentv1.Deploy) {
	peer := transport.Peer{ID: server}
	var seq uint64
	send := func(s *agentv1.DeployStatus) {
		s.DeployId, s.AppId = dep.DeployId, dep.App.AppId
		_ = d.Core.AgentEvent(ctx, peer, &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: s}})
	}
	log := func(line string) {
		seq++
		_ = d.Core.AgentEvent(ctx, peer, &agentv1.Event{Payload: &agentv1.Event_DeployLog{DeployLog: &agentv1.DeployLog{DeployId: dep.DeployId, AppId: dep.App.AppId, Sequence: seq, Line: []byte(line + "\n")}}})
	}
	failing := strings.HasPrefix(dep.Sha, "dead") && dep.App.GetPort() != 3000
	for _, st := range devStages {
		if st.name == "start" {
			send(&agentv1.DeployStatus{Status: "starting"})
		}
		started := time.Now()
		timer := time.NewTimer(st.duration)
		select {
		case <-job.Done():
			timer.Stop()
			log("[dev] cancelled")
			send(&agentv1.DeployStatus{Status: "cancelled"})
			return
		case <-timer.C:
		}
		if failing && st.name == "healthcheck" {
			log("[start] listening on 0.0.0.0:3000")
			log(fmt.Sprintf("[healthcheck] no response on port %d at / within the timeout", dep.App.GetPort()))
			send(&agentv1.DeployStatus{Status: "failed", ErrorCode: "health_no_response"})
			return
		}
		for _, line := range st.lines {
			log(line)
		}
		send(&agentv1.DeployStatus{Stage: st.name, DurationMs: time.Since(started).Milliseconds()})
	}
	send(&agentv1.DeployStatus{Status: "success"})
}
