package service

import (
	"context"
	"database/sql"
	"encoding/json"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"strings"
	"time"
)

const DevUserID = "development-user"

func (c *Core) Seed(ctx context.Context) error {
	ctx = systemContext(ctx)
	_, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,'admin',?) ON CONFLICT DO NOTHING", DevUserID, "dev@localhost", "Desenvolvimento", time.Now().Unix())
	if e != nil {
		return e
	}
	for i, name := range []string{"loja", "api", "blog"} {
		server := "dev-server-" + name
		app := "dev-app-" + name
		cfg := AppConfig{Domains: []string{name + ".example.test"}, MemoryBytes: 256 << 20, NanoCPUs: 1e9, Port: 8080, HealthPath: "/", HealthTimeout: 60, Replicas: 1, CacheEnabled: true, Dockerfile: "Dockerfile"}
		b, _ := json.Marshal(cfg)
		e = c.mutate(ctx, func(tx *sql.Tx) error {
			if _, e := tx.ExecContext(ctx, "INSERT INTO servers(id,name,wireguard_ip,status,heartbeat_at,fingerprint) VALUES(?,?,?,'online',?,'development') ON CONFLICT DO NOTHING", server, "Servidor "+name, "10.77.0."+string(rune('2'+i)), time.Now().Unix()); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "INSERT INTO apps(id,name,server_id,repository,branch,config) VALUES(?,?,?,?,'main',?) ON CONFLICT DO NOTHING", app, name, server, "https://github.com/example/"+name, string(b)); e != nil {
				return e
			}
			for j, status := range []string{"success", "failed", "cancelled"} {
				id := "dev-deploy-" + name + "-" + status
				if _, e := tx.ExecContext(ctx, "INSERT INTO deployments(id,app_id,sha,message,author,origin,status,queued_at,started_at,finished_at) VALUES(?,?,?,?,?,'push',?,?,?,?) ON CONFLICT DO NOTHING", id, app, strings.Repeat(string(rune('a'+i)), 40), "Deploy de demonstração", "Desenvolvimento", status, time.Now().Unix()-int64((j+1)*3600), time.Now().Unix()-int64((j+1)*3600)+1, time.Now().Unix()-int64((j+1)*3600)+8); e != nil {
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
			if e = c.LogStore.Append(ctx, id, []byte("[clone] SHA confirmado\n[build] cache hit\n[healthcheck] saudável\n[route] versão publicada\n")); e != nil {
				return e
			}
		}
	}
	return nil
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
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case item := <-d.queue:
			dep := item.command.GetDeploy()
			if dep == nil {
				continue
			}
			for i, status := range []string{"building", "starting", "success"} {
				timer := time.NewTimer(600 * time.Millisecond)
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case <-timer.C:
				}
				_ = d.Core.AgentEvent(ctx, transport.Peer{ID: item.server, Fingerprint: "development"}, &agentv1.Event{Payload: &agentv1.Event_DeployLog{DeployLog: &agentv1.DeployLog{DeployId: dep.DeployId, AppId: dep.App.AppId, Sequence: uint64(i + 1), Line: []byte("[dev] " + status + "\n")}}})
				_ = d.Core.AgentEvent(ctx, transport.Peer{ID: item.server}, &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: dep.DeployId, AppId: dep.App.AppId, Status: status}}})
			}
		case <-tick.C:
			servers, _ := d.Core.DB.Queries.ListServers(ctx)
			for _, s := range servers {
				_, _ = d.Core.DB.Write.ExecContext(ctx, "UPDATE servers SET heartbeat_at=?,status='online' WHERE id=?", time.Now().Unix(), s.ID)
				d.Core.publish("servers", "server.metrics", map[string]any{"server_id": s.ID, "metrics": map[string]any{"cpu_percent": 12, "memory_used": 128 << 20, "memory_total": 4 << 30, "disk_used": 2 << 30, "disk_total": 40 << 30}})
			}
			apps, _ := d.Core.DB.Queries.ListApps(ctx)
			for _, a := range apps {
				d.Core.publish("app/"+a.ID, "runtime.log", map[string]any{"line": "[dev] GET /health 200\n", "sequence": time.Now().Unix()})
			}
		}
	}
}
