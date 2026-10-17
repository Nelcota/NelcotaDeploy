package service

import (
	"context"
	"database/sql"

	"errors"
	"regexp"
	"strings"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
)

// heartbeatTimeout is how long a server counts as connected after its last
// heartbeat, for scheduling deployments and updates.
const heartbeatTimeout = 20 * time.Second

func heartbeatCutoff() int64 { return time.Now().Add(-heartbeatTimeout).Unix() }

type deploysService struct{ c *Core }

func (s *deploysService) List(ctx context.Context, app string) ([]Deployment, error) {
	if _, e := authorize(ctx, "deploys:read", false); e != nil {
		return nil, e
	}
	if _, e := (&appsService{s.c}).Get(ctx, app); e != nil {
		return nil, e
	}
	rows, e := s.c.DB.Queries.ListDeployments(ctx, app)
	out := make([]Deployment, 0, len(rows))
	for _, r := range rows {
		out = append(out, decodeDeploy(r))
	}
	return out, dbError(e)
}
func (s *deploysService) Get(ctx context.Context, id string) (Deployment, error) {
	if _, e := authorize(ctx, "deploys:read", false); e != nil {
		return Deployment{}, e
	}
	r, e := s.c.DB.Queries.GetDeployment(ctx, id)
	return decodeDeploy(r), dbError(e)
}
func (s *deploysService) Enqueue(ctx context.Context, in DeployInput) (Deployment, error) {
	if _, e := authorize(ctx, "deploys:write", false); e != nil {
		return Deployment{}, e
	}
	if !shaPattern.MatchString(in.SHA) {
		return Deployment{}, fail(Validation, "Full SHA required")
	}
	if in.Origin == "" {
		in.Origin = "manual"
	}
	if in.Origin != "push" && in.Origin != "manual" && in.Origin != "rollback" {
		return Deployment{}, fail(Validation, "Invalid origin")
	}
	if len(in.Message) > 1000 || len(in.Author) > 200 {
		return Deployment{}, fail(Validation, "Metadata too large")
	}
	if _, e := (&appsService{s.c}).Get(ctx, in.AppID); e != nil {
		return Deployment{}, e
	}
	id := security.Token()
	e := s.c.mutate(ctx, func(tx *sql.Tx) error { return s.enqueue(ctx, tx, id, in) })
	if e != nil {
		return Deployment{}, e
	}
	d, e := s.Get(ctx, id)
	s.c.publish("deployments", "deploy.queued", d)
	return d, e
}
func (s *deploysService) enqueue(ctx context.Context, tx *sql.Tx, id string, in DeployInput) error {
	now := time.Now().Unix()
	q := dbgen.New(tx)
	if e := q.CancelQueuedDeployments(ctx, dbgen.CancelQueuedDeploymentsParams{FinishedAt: now, AppID: in.AppID}); e != nil {
		return e
	}
	clean := int64(0)
	if in.Clean {
		clean = 1
	}
	e := q.InsertQueuedDeployment(ctx, dbgen.InsertQueuedDeploymentParams{
		ID: id, AppID: in.AppID, Sha: strings.ToLower(in.SHA), Message: in.Message, Author: in.Author,
		Origin: in.Origin, QueuedAt: now, Clean: clean, RetryOf: in.retryOf,
	})
	if e != nil {
		return e
	}
	return s.c.audit(ctx, tx, "deploy.enqueue", id)
}
func (s *deploysService) Cancel(ctx context.Context, id string) error {
	if _, e := authorize(ctx, "deploys:write", false); e != nil {
		return e
	}
	d, e := s.Get(ctx, id)
	if e != nil {
		return e
	}
	if d.Status == "success" || d.Status == "failed" || d.Status == "cancelled" {
		return fail(Conflict, "Deployment already finished")
	}
	e = s.c.mutate(ctx, func(tx *sql.Tx) error {
		if e := dbgen.New(tx).RequestCancel(ctx, dbgen.RequestCancelParams{FinishedAt: time.Now().Unix(), ID: id}); e != nil {
			return e
		}
		if d.Status == "queued" && s.c.GitHub != nil {
			if e := queueCheck(ctx, tx, id, "cancelled"); e != nil {
				return e
			}
		}
		return s.c.audit(ctx, tx, "deploy.cancel", id)
	})
	if e != nil {
		return e
	}
	updated, _ := s.Get(ctx, id)
	s.c.publish("deployments", "deploy.status", updated)
	s.c.publish("deploy/"+id, "deploy.status", updated)
	if d.Status != "queued" {
		a, e := (&appsService{s.c}).Get(ctx, d.AppID)
		if e != nil {
			return e
		}
		if s.c.Control == nil {
			return fail(Unavailable, "Cancellation pending until the agent connects")
		}
		return s.c.send(ctx, a.ServerID, &agentv1.Command{Action: &agentv1.Command_Cancel{Cancel: &agentv1.Cancel{DeployId: id}}})
	}
	return nil
}
func (s *deploysService) Rollback(ctx context.Context, app, sha string) (Deployment, error) {
	return s.Enqueue(ctx, DeployInput{AppID: app, SHA: sha, Origin: "rollback"})
}

// Claim serializes capacity checks and queue transitions on SQLite's single writer.
func (c *Core) Claim(ctx context.Context) (Deployment, error) {
	var id string
	e := c.mutate(ctx, func(tx *sql.Tx) error {
		q := dbgen.New(tx)
		var e error
		id, e = q.NextQueuedDeployment(ctx, heartbeatCutoff())
		if errors.Is(e, sql.ErrNoRows) {
			return fail(NotFound, "Queue empty")
		}
		if e != nil {
			return e
		}
		return q.StartDeployment(ctx, dbgen.StartDeploymentParams{StartedAt: time.Now().Unix(), ID: id})
	})
	if e != nil {
		return Deployment{}, e
	}
	return (&deploysService{c}).Get(systemContext(ctx), id)
}
func (c *Core) RunScheduler(ctx context.Context) error {
	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
			if c.Control == nil {
				continue
			}
			d, e := c.Claim(ctx)
			if Is(e, NotFound) {
				continue
			}
			if e != nil {
				continue
			}
			a, e := c.DB.Queries.GetApp(ctx, d.AppID)
			if e != nil {
				continue
			}
			cfg, e := c.agentConfig(ctx, decodeApp(a))
			if e != nil {
				c.failDispatch(ctx, d.ID, "config_unavailable")
				continue
			}
			token := ""
			if cfg.InstallationId != 0 {
				if c.GitHub == nil {
					c.failDispatch(ctx, d.ID, "github_unavailable")
					continue
				}
				token, e = c.GitHub.Token(ctx, cfg.InstallationId)
				if e != nil {
					c.failDispatch(ctx, d.ID, "github_unavailable")
					continue
				}
			}
			if c.GitHub != nil {
				_ = c.mutate(ctx, func(tx *sql.Tx) error { return queueCheck(ctx, tx, d.ID, "building") })
			}

			e = c.Control.Send(ctx, a.ServerID, &agentv1.Command{Action: &agentv1.Command_Deploy{Deploy: &agentv1.Deploy{DeployId: d.ID, App: cfg, Sha: d.SHA, GithubToken: token, Clean: d.Clean}}})
			if e != nil {
				c.failDispatch(ctx, d.ID, "agent_unavailable")
				continue
			}
			c.publish("deployments", "deploy.status", d)
		}
	}
}
func (c *Core) failDispatch(ctx context.Context, id, code string) {
	_ = c.mutate(ctx, func(tx *sql.Tx) error {
		e := dbgen.New(tx).FailDispatch(ctx, dbgen.FailDispatchParams{ErrorCode: code, FinishedAt: time.Now().Unix(), ID: id})
		if e != nil {
			return e
		}
		if c.GitHub != nil {
			return queueCheck(ctx, tx, id, "failed")
		}
		return nil
	})
	if d, e := (&deploysService{c}).Get(systemContext(ctx), id); e == nil {
		c.publish("deployments", "deploy.status", d)
		c.publish("deploy/"+id, "deploy.status", d)
	}
}
func (c *Core) agentConfig(ctx context.Context, a App) (*agentv1.AppConfig, error) {
	p := &agentv1.AppConfig{
		AppId: a.ID, Repository: a.Repository, Branch: a.Branch, Domains: a.Config.Domains,
		MemoryBytes: a.Config.MemoryBytes, NanoCpus: a.Config.NanoCPUs, Port: a.Config.Port,
		HealthPath: a.Config.HealthPath, HealthTimeoutSeconds: a.Config.HealthTimeout, Replicas: a.Config.Replicas,
		CacheEnabled: a.Config.CacheEnabled, Dockerfile: a.Config.Dockerfile, InstallationId: a.Config.InstallationID,
		DesiredSha: a.DesiredSHA, Stopped: a.Config.Stopped, Revision: uint64(a.Revision),
		Env: map[string]string{}, BuildSecrets: map[string]string{},
	}
	vars, e := c.DB.Queries.GetEnvironment(ctx, a.ID)
	if e != nil {
		return nil, e
	}
	for _, v := range vars {
		b, e := c.Vault.Open(v.Encrypted, a.ID+":"+v.Key)
		if e != nil {
			return nil, e
		}
		if v.Build != 0 {
			p.BuildSecrets[v.Key] = string(b)
		} else {
			p.Env[v.Key] = string(b)
		}
	}
	return p, nil
}
func (c *Core) AgentConnected(ctx context.Context, p transport.Peer) error {
	n, e := dbgen.New(c.DB.Write).ConnectAgent(ctx, dbgen.ConnectAgentParams{Now: time.Now().Unix(), ID: p.ID, Fingerprint: p.Fingerprint})
	if e != nil {
		return e
	}
	if n != 1 {
		return fail(Forbidden, "Agent not registered")
	}
	return nil
}
func (c *Core) AgentDisconnected(ctx context.Context, p transport.Peer) {
	_, _ = c.DB.Write.ExecContext(ctx, "UPDATE servers SET status='offline',agent_ready=0 WHERE id=?", p.ID)
	c.publish("servers", "server.offline", map[string]string{"id": p.ID})
}
func (c *Core) AgentEvent(ctx context.Context, p transport.Peer, e *agentv1.Event) error {
	switch v := e.Payload.(type) {
	case *agentv1.Event_OperationResult:
		return c.operationResult(ctx, p.ID, v.OperationResult)
	case *agentv1.Event_Heartbeat:
		ready := int64(0)
		if v.Heartbeat.Ready {
			ready = 1
		}
		heartbeat := dbgen.RecordHeartbeatParams{HeartbeatAt: time.Now().Unix(), AgentVersion: v.Heartbeat.Version, AgentReady: ready, ID: p.ID}
		if err := dbgen.New(c.DB.Write).RecordHeartbeat(ctx, heartbeat); err != nil {
			return err
		}
		if err := c.operationResult(ctx, p.ID, v.Heartbeat.UpdateResult); err != nil {
			return err
		}
		if err := func() error {
			if !v.Heartbeat.Ready {
				return nil
			}
			return c.observedState(ctx, p.ID, v.Heartbeat)
		}(); err != nil {
			return err
		}
		if v.Heartbeat.RequestState {
			return c.sendSnapshot(ctx, p.ID)
		}
	case *agentv1.Event_DeployLog:
		l := v.DeployLog
		if len(l.Line) > 16384 {
			return fail(Validation, "Log exceeds the limit")
		}
		if l.Runtime {
			a, err := c.DB.Queries.GetApp(ctx, l.AppId)
			if err != nil || a.ServerID != p.ID {
				return fail(Forbidden, "App does not belong to this server")
			}
			c.publish("app/"+l.AppId, "runtime.log", map[string]any{"line": mustMaskRuntime(c, ctx, a.ID, string(l.Line)), "sequence": l.Sequence})
			return nil
		}
		d, err := c.DB.Queries.GetDeployment(ctx, l.DeployId)
		if err != nil {
			return err
		}
		a, err := c.DB.Queries.GetApp(ctx, d.AppID)
		if err != nil || a.ServerID != p.ID || d.AppID != l.AppId {
			return fail(Forbidden, "Deployment does not belong to this server")
		}
		safe, err := c.maskApp(ctx, a.ID, string(l.Line))
		if err != nil {
			return err
		}
		if err = c.LogStore.Append(ctx, d.ID, []byte(safe)); err != nil {
			return err
		}
		c.publish("deploy/"+d.ID, "deploy.log", map[string]any{"line": safe, "sequence": l.Sequence})
	case *agentv1.Event_DeployStatus:
		s := v.DeployStatus
		d, err := c.DB.Queries.GetDeployment(ctx, s.DeployId)
		if err != nil {
			return err
		}
		a, err := c.DB.Queries.GetApp(ctx, d.AppID)
		if err != nil || a.ServerID != p.ID || d.AppID != s.AppId {
			return fail(Forbidden, "Deployment does not belong to this server")
		}
		if s.Stage != "" {
			switch s.Stage {
			case "clone", "build", "start", "healthcheck", "route":
			default:
				return fail(Validation, "Invalid stage")
			}
			if s.DurationMs < 0 {
				return fail(Validation, "Invalid duration")
			}
			_, err = c.DB.Write.ExecContext(ctx, "UPDATE deployments SET timings=json_set(timings,?,?) WHERE id=?", "$."+s.Stage, s.DurationMs, d.ID)
			if err != nil {
				return err
			}
			c.publish("deploy/"+d.ID, "deploy.stage", map[string]any{"stage": s.Stage, "duration_ms": s.DurationMs})
			return nil
		}
		if !validTransition(d.Status, s.Status) {
			return nil
		}
		terminal := s.Status == "success" || s.Status == "failed" || s.Status == "cancelled"
		err = c.mutate(ctx, func(tx *sql.Tx) error {
			finished := int64(0)
			if terminal {
				finished = time.Now().Unix()
			}
			code := ""
			if s.Status == "failed" {
				code = failureCode(s.ErrorCode)
			}
			if _, err := tx.ExecContext(ctx, "UPDATE deployments SET status=?,finished_at=?,error_code=? WHERE id=?", s.Status, finished, code, d.ID); err != nil {
				return err
			}
			if terminal && c.GitHub != nil {
				if err := queueCheck(ctx, tx, d.ID, s.Status); err != nil {
					return err
				}
			}
			if s.Status == "success" {
				_, err := tx.ExecContext(ctx, "UPDATE apps SET desired_sha=? WHERE id=?", d.Sha, d.AppID)
				return err
			}
			if s.Status == "failed" {
				return retryTransient(ctx, c, tx, d, code)
			}
			return nil
		})
		if err != nil {
			return err
		}
		updated, _ := (&deploysService{c}).Get(systemContext(ctx), d.ID)
		c.publish("deployments", "deploy.status", updated)
		c.publish("deploy/"+d.ID, "deploy.status", updated)
		if terminal {

			_ = c.retainLogs(ctx, a.ID)
		}
	case *agentv1.Event_ContainerEvent:
		app, err := c.DB.Queries.GetApp(ctx, v.ContainerEvent.AppId)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if app.ServerID != p.ID {
			return fail(Forbidden, "App does not belong to this server")
		}
		c.publish("servers", "container.event", v.ContainerEvent)
	case *agentv1.Event_Metrics:
		if len(v.Metrics.Containers) > 256 {
			return fail(Validation, "Metrics exceed the limit")
		}
		ownedMetrics := make([]*agentv1.ContainerMetrics, 0, len(v.Metrics.Containers))
		for _, metric := range v.Metrics.Containers {
			if metric == nil {
				return fail(Validation, "Invalid metric")
			}
			app, err := c.DB.Queries.GetApp(ctx, metric.AppId)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			if app.ServerID != p.ID {
				return fail(Forbidden, "Metric does not belong to this server")
			}
			ownedMetrics = append(ownedMetrics, metric)
		}
		v.Metrics.Containers = ownedMetrics
		c.publish("servers", "server.metrics", map[string]any{"server_id": p.ID, "metrics": v.Metrics})
		c.relieveDisk(ctx, p.ID, v.Metrics)
	default:
		return fail(Validation, "Unknown event")
	}
	return nil
}
func validTransition(from, to string) bool {
	switch from {
	case "building":
		return to == "starting" || to == "failed" || to == "cancelled"
	case "starting":
		return to == "success" || to == "failed" || to == "cancelled"
	}
	return false
}
func (c *Core) sendSnapshot(ctx context.Context, server string) error {
	rows, e := c.DB.Queries.ListApps(ctx)
	if e != nil {
		return e
	}
	serverConfig, e := c.DB.Queries.GetServer(ctx, server)
	if e != nil {
		return e
	}
	snapshot := &agentv1.Snapshot{Limits: &agentv1.ServerLimits{BuildLimit: uint32(serverConfig.BuildLimit), CacheBytes: serverConfig.CacheBytes}}
	for _, r := range rows {
		if r.ServerID != server {
			continue
		}
		cfg, e := c.agentConfig(ctx, decodeApp(r))
		if e != nil {
			return e
		}
		snapshot.Apps = append(snapshot.Apps, cfg)
	}
	if e = c.Control.Send(ctx, server, &agentv1.Command{Desired: snapshot}); e != nil {
		return e
	}
	c.logMu.Lock()
	ids := make([]string, 0, len(c.runtimeWatchers))
	for id := range c.runtimeWatchers {
		ids = append(ids, id)
	}
	c.logMu.Unlock()
	for _, id := range ids {
		for _, app := range snapshot.Apps {
			if app.AppId == id {
				_ = c.Control.Send(ctx, server, &agentv1.Command{Action: &agentv1.Command_Logs{Logs: &agentv1.Logs{AppId: id, Follow: true}}})
			}
		}
	}
	return nil
}
func (c *Core) maskApp(ctx context.Context, id, line string) (string, error) {
	vars, e := c.DB.Queries.GetEnvironment(ctx, id)
	if e != nil {
		return "", e
	}
	secrets := []string{}
	for _, v := range vars {
		b, e := c.Vault.Open(v.Encrypted, id+":"+v.Key)
		if e != nil {
			return "", e
		}
		secrets = append(secrets, string(b))
	}
	return security.NewRedactor(secrets).Mask(line), nil
}
func (c *Core) retainLogs(ctx context.Context, app string) error {
	ids, e := c.DB.Queries.ListExpiredLogDeployments(ctx, app)
	if e != nil {
		return e
	}
	for _, id := range ids {
		if e = c.LogStore.Remove(ctx, id); e != nil {
			return e
		}
	}
	return nil
}

// observedState repairs terminal transitions lost during an interrupted RPC session.
func (c *Core) observedState(ctx context.Context, server string, h *agentv1.Heartbeat) error {
	active := map[string]bool{}
	for _, id := range h.ActiveDeploys {
		active[id] = true
	}
	observed := map[string]*agentv1.ObservedApp{}
	for _, app := range h.Apps {
		observed[app.DeployId] = app
	}
	jobs, e := c.DB.Queries.ListServerActiveDeployments(ctx, server)
	if e != nil {
		return e
	}
	for _, j := range jobs {
		if active[j.ID] {
			continue
		}
		report := func(status string) error {
			update := &agentv1.DeployStatus{DeployId: j.ID, AppId: j.AppID, Status: status}
			return c.AgentEvent(ctx, transport.Peer{ID: server}, &agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: update}})
		}
		if o := observed[j.ID]; o != nil && o.AppId == j.AppID && o.Sha == j.Sha {
			if j.Status == "building" {
				if e = report("starting"); e != nil {
					return e
				}
			}
			if e = report("success"); e != nil {
				return e
			}
			continue
		}
		if time.Now().Unix()-j.StartedAt > 30 {
			state := "failed"
			if j.CancelRequested != 0 {
				state = "cancelled"
			}
			if e = report(state); e != nil {
				return e
			}
		}
	}
	return nil
}

func mustMaskRuntime(c *Core, ctx context.Context, id, line string) string {
	safe, e := c.maskApp(ctx, id, line)
	if e != nil {
		return "[log unavailable]"
	}
	return safe
}

var failureCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// transientFailures are failures that usually pass on a second attempt
// without any change. Build, start, and health check failures are never
// retried: they need a fix, and retrying would hide them.
var transientFailures = map[string]bool{"route_failed": true}

// retryTransient queues one automatic retry of a deployment that failed for a
// transient reason, unless it was itself a retry, it was cancelled, the app is
// stopped, or a newer deployment already exists.
func retryTransient(ctx context.Context, c *Core, tx *sql.Tx, d dbgen.Deployment, code string) error {
	if !transientFailures[code] || d.RetryOf != "" || d.CancelRequested != 0 {
		return nil
	}
	var newer int
	if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM deployments WHERE app_id=? AND id<>? AND queued_at>=?", d.AppID, d.ID, d.QueuedAt).Scan(&newer); e != nil {
		return e
	}
	var stopped bool
	if e := tx.QueryRowContext(ctx, "SELECT COALESCE(json_extract(config,'$.stopped'),0) FROM apps WHERE id=?", d.AppID).Scan(&stopped); e != nil {
		return e
	}
	if newer > 0 || stopped {
		return nil
	}
	in := DeployInput{AppID: d.AppID, SHA: d.Sha, Message: d.Message, Author: d.Author, Origin: d.Origin, Clean: d.Clean != 0, retryOf: d.ID}
	return (&deploysService{c}).enqueue(systemContext(ctx), tx, security.Token(), in)
}

// failureCode keeps an agent-reported failure reason when it is a plain code,
// so the interface can explain it; anything else becomes the generic code.
func failureCode(reported string) string {
	if failureCodePattern.MatchString(reported) {
		return reported
	}
	return "deployment_failed"
}
