package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"google.golang.org/protobuf/proto"
)

type Running struct {
	AppID      string   `json:"app_id"`
	DeployID   string   `json:"deploy_id"`
	SHA        string   `json:"sha"`
	Image      string   `json:"image"`
	Containers []string `json:"containers"`
	Addresses  []string `json:"addresses"`
	Revision   uint64   `json:"revision"`
}
type Engine interface {
	Clone(context.Context, *agentv1.Deploy, string, func([]byte)) error
	Build(context.Context, *agentv1.Deploy, string, func([]byte)) (string, error)
	Start(context.Context, *agentv1.AppConfig, string) (Running, error)
	Health(context.Context, *agentv1.AppConfig, Running) error
	Route(context.Context, *agentv1.AppConfig, Running) error
	Remove(context.Context, Running) error
	Inspect(context.Context, Running) (bool, error)
	Stop(context.Context, Running) error
	Restart(context.Context, Running) error
	Logs(context.Context, Running, int64, bool, func([]byte)) error
	Prune(context.Context, agentv1.Prune_Scope) error
}
type active struct {
	cancel context.CancelFunc
	app    string
}
type Pipeline struct {
	OnDeployFinished func(string, time.Duration)
	Engine           Engine
	State            *StateStore
	Root             string
	Limit            int
	mu               sync.Mutex
	active           map[string]active
	apps             map[string]bool
	desired          map[string]*agentv1.AppConfig
	running          map[string]Running
	pending          map[string]Running
	rings            map[string]*events.Ring
	wg               sync.WaitGroup
	logCancels       map[string]context.CancelFunc
	Stats            func(context.Context) *agentv1.Metrics
	ready            bool
	QueueUpdate      func(string, string) error
	UpdatePending    func() bool
}

func NewPipeline(engine Engine, state *StateStore, root string, limit int) (*Pipeline, error) {
	if limit < 1 {
		limit = 1
	}
	p := &Pipeline{
		Engine:     engine,
		State:      state,
		Root:       root,
		Limit:      limit,
		active:     map[string]active{},
		apps:       map[string]bool{},
		desired:    map[string]*agentv1.AppConfig{},
		running:    map[string]Running{},
		pending:    map[string]Running{},
		rings:      map[string]*events.Ring{},
		logCancels: map[string]context.CancelFunc{},
	}
	if e := p.load(); e != nil {
		return nil, e
	}
	return p, nil
}

var shaRE = regexp.MustCompile(`^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$`)

func key(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:12]) }
func (p *Pipeline) Active() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	ids := make([]string, 0, len(p.active))
	for id := range p.active {
		ids = append(ids, id)
	}
	return ids
}
func (p *Pipeline) Run(ctx context.Context) error {
	p.reconcile(ctx)
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	defer func() {
		p.mu.Lock()
		for _, a := range p.active {
			a.cancel()
		}
		p.mu.Unlock()
		p.wg.Wait()
	}()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
			p.reconcile(ctx)
		}
	}
}
func (p *Pipeline) Handle(ctx context.Context, c *agentv1.Command, emit func(*agentv1.Event) error) error {
	if c.Desired != nil {
		if limits := c.Desired.Limits; limits != nil {
			if limits.BuildLimit < 1 || limits.BuildLimit > 8 || limits.CacheBytes < 64<<20 || limits.CacheBytes > 100<<30 {
				return errors.New("invalid server limits")
			}
			p.mu.Lock()
			p.Limit = int(limits.BuildLimit)
			p.mu.Unlock()
			if configurable, ok := p.Engine.(interface{ SetCacheLimit(int64) }); ok {
				configurable.SetCacheLimit(limits.CacheBytes)
			}
		}
		p.mu.Lock()
		p.desired = map[string]*agentv1.AppConfig{}
		for _, a := range c.Desired.Apps {
			p.desired[a.AppId] = proto.Clone(a).(*agentv1.AppConfig)
		}
		e := p.saveLocked()
		p.mu.Unlock()
		if e != nil {
			return e
		}
		p.reconcile(ctx)
	}
	switch a := c.Action.(type) {
	case *agentv1.Command_Update:
		status := p.RequestUpdate(a.Update.Id, a.Update.Version)
		return emit(&agentv1.Event{Payload: &agentv1.Event_OperationResult{OperationResult: &agentv1.OperationResult{Id: a.Update.Id, Status: status}}})
	case *agentv1.Command_Deploy:
		return p.launch(ctx, a.Deploy, emit)
	case *agentv1.Command_Rollback:
		return p.launch(ctx, a.Rollback.Deploy, emit)
	case *agentv1.Command_Cancel:
		p.mu.Lock()
		if job, ok := p.active[a.Cancel.DeployId]; ok {
			job.cancel()
		}
		p.mu.Unlock()
	case *agentv1.Command_SetConfig:
		p.mu.Lock()
		p.desired[a.SetConfig.AppId] = proto.Clone(a.SetConfig).(*agentv1.AppConfig)
		e := p.saveLocked()
		p.mu.Unlock()
		return e
	case *agentv1.Command_Start:
		return p.setStopped(a.Start.AppId, false)
	case *agentv1.Command_Stop:
		return p.setStopped(a.Stop.AppId, true)
	case *agentv1.Command_Restart:
		p.mu.Lock()
		r := p.running[a.Restart.AppId]
		p.mu.Unlock()
		return p.Engine.Restart(ctx, r)
	case *agentv1.Command_Scale:
		p.mu.Lock()
		cfg := p.desired[a.Scale.AppId]
		if cfg != nil && a.Scale.Replicas > 0 && a.Scale.Replicas <= 16 {
			cfg.Replicas = a.Scale.Replicas
		}
		e := p.saveLocked()
		p.mu.Unlock()
		return e

	case *agentv1.Command_Logs:
		p.mu.Lock()
		r := p.running[a.Logs.AppId]
		cfg := p.desired[a.Logs.AppId]
		if cancel, exists := p.logCancels[a.Logs.AppId]; exists {
			if !a.Logs.Follow {
				cancel()
			}
			p.mu.Unlock()
			return nil
		}
		if cfg == nil {
			p.mu.Unlock()
			return nil
		}
		logCtx, cancel := context.WithCancel(ctx)
		p.logCancels[a.Logs.AppId] = cancel
		p.mu.Unlock()
		p.wg.Go(func() {
			defer cancel()
			defer func() { p.mu.Lock(); delete(p.logCancels, a.Logs.AppId); p.mu.Unlock() }()
			masker := security.NewLineMasker(redactor(cfg, ""), func(b []byte) {
				_ = emit(&agentv1.Event{Payload: &agentv1.Event_DeployLog{DeployLog: &agentv1.DeployLog{AppId: cfg.AppId, Line: append([]byte(nil), b...), Runtime: true}}})
			})
			defer masker.Flush()
			_ = p.Engine.Logs(logCtx, r, a.Logs.SinceUnix, a.Logs.Follow, func(b []byte) { _, _ = masker.Write(b) })
		})

	case *agentv1.Command_Prune:
		return p.Engine.Prune(ctx, a.Prune.Scope)
	case *agentv1.Command_Stats:
		if p.Stats != nil {
			return emit(&agentv1.Event{Payload: &agentv1.Event_Metrics{Metrics: p.Stats(ctx)}})
		}
	case nil:
	default:
		return errors.New("unsupported typed action")
	}
	return nil
}
func (p *Pipeline) setStopped(id string, stopped bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	cfg := p.desired[id]
	if cfg == nil {
		return errors.New("unknown app")
	}
	cfg.Stopped = stopped
	return p.saveLocked()
}
func redactor(app *agentv1.AppConfig, token string) *security.Redactor {
	values := []string{token}
	for _, v := range app.Env {
		values = append(values, v)
	}
	for _, v := range app.BuildSecrets {
		values = append(values, v)
	}
	return security.NewRedactor(values)
}
func (p *Pipeline) launch(ctx context.Context, d *agentv1.Deploy, emit func(*agentv1.Event) error) error {
	if d == nil || d.App == nil || d.DeployId == "" || !shaRE.MatchString(d.Sha) {
		return errors.New("invalid deploy")
	}
	p.mu.Lock()
	if _, ok := p.active[d.DeployId]; ok {
		p.mu.Unlock()
		return nil
	}
	if len(p.active) >= p.Limit || p.apps[d.App.AppId] || (p.UpdatePending != nil && p.UpdatePending()) {
		p.mu.Unlock()
		return errors.New("build capacity exceeded")
	}
	jobCtx, cancel := context.WithCancel(ctx)
	p.active[d.DeployId] = active{cancel, d.App.AppId}
	p.apps[d.App.AppId] = true
	p.mu.Unlock()
	p.wg.Go(func() {
		defer cancel()
		defer func() {
			p.mu.Lock()
			delete(p.active, d.DeployId)
			delete(p.apps, d.App.AppId)
			delete(p.rings, d.DeployId)
			p.mu.Unlock()
		}()
		p.deploy(jobCtx, d, emit)
	})
	return nil
}
func (p *Pipeline) deploy(ctx context.Context, d *agentv1.Deploy, emit func(*agentv1.Event) error) {
	deployStarted := time.Now()
	defer func() {
		if p.OnDeployFinished != nil {
			p.OnDeployFinished(d.DeployId, time.Since(deployStarted))
		}
	}()
	status := func(s string) {
		_ = emit(&agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: d.DeployId, AppId: d.App.AppId, Status: s}}})
	}
	stage := func(name string, started time.Time) {
		_ = emit(&agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: d.DeployId, AppId: d.App.AppId, Stage: name, DurationMs: time.Since(started).Milliseconds()}}})
	}
	success := false
	// code names the step that failed so the panel can explain it to people.
	code := "workspace_error"
	defer func() {
		if !success {
			if ctx.Err() != nil {
				status("cancelled")
			} else {
				_ = emit(&agentv1.Event{Payload: &agentv1.Event_DeployStatus{DeployStatus: &agentv1.DeployStatus{DeployId: d.DeployId, AppId: d.App.AppId, Status: "failed", ErrorCode: code}}})
			}
		}
	}()
	if e := os.MkdirAll(p.Root, 0700); e != nil {
		return
	}
	dir, e := os.MkdirTemp(p.Root, "build-")
	if e != nil {
		return
	}
	defer os.RemoveAll(dir)
	ring := events.NewRing(1024)
	p.mu.Lock()
	p.rings[d.DeployId] = ring
	old := p.running[d.App.AppId]
	p.mu.Unlock()
	mask := redactor(d.App, d.GithubToken)
	log := func(b []byte) {
		line := append([]byte(nil), b...)
		seq := ring.Append(line)
		_ = emit(&agentv1.Event{Payload: &agentv1.Event_DeployLog{DeployLog: &agentv1.DeployLog{DeployId: d.DeployId, AppId: d.App.AppId, Sequence: seq, Line: line}}})
	}
	masker := security.NewLineMasker(mask, log)
	defer masker.Flush()
	safeLog := func(b []byte) { _, _ = masker.Write(b) }
	started := time.Now()
	code = "clone_failed"
	if e = p.Engine.Clone(ctx, d, dir, safeLog); e != nil {
		return
	}
	stage("clone", started)
	started = time.Now()
	code = "build_failed"
	image, e := p.Engine.Build(ctx, d, dir, safeLog)
	if e != nil {
		return
	}
	stage("build", started)
	fresh := Running{Image: image, AppID: d.App.AppId}
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			_ = p.Engine.Remove(cleanup, fresh)
		}
	}()
	status("starting")
	started = time.Now()
	code = "start_failed"
	fresh, e = p.Engine.Start(ctx, d.App, image)
	if e != nil {
		return
	}
	stage("start", started)
	fresh.SHA = d.Sha
	fresh.DeployID = d.DeployId
	fresh.Revision = d.App.Revision
	started = time.Now()
	if e = p.Engine.Health(ctx, d.App, fresh); e != nil {
		code = healthCode(ctx, p.Engine, fresh, e)
		appOutput(ctx, p.Engine, fresh, safeLog)
		return
	}
	code = "state_error"
	stage("healthcheck", started)
	if e = ctx.Err(); e != nil {
		return
	}
	// Persist the intended switch before touching the route, so restart recovery is deterministic.
	p.mu.Lock()
	prior := p.desired[d.App.AppId]
	cfg := proto.Clone(d.App).(*agentv1.AppConfig)
	cfg.DesiredSha = d.Sha
	p.running[d.App.AppId] = fresh
	p.desired[d.App.AppId] = cfg
	p.pending[d.App.AppId] = old
	e = p.saveLocked()
	if e != nil {
		if old.AppID != "" {
			p.running[d.App.AppId] = old
		} else {
			delete(p.running, d.App.AppId)
		}
		if prior != nil {
			p.desired[d.App.AppId] = prior
		} else {
			delete(p.desired, d.App.AppId)
		}
		delete(p.pending, d.App.AppId)
	}
	p.mu.Unlock()
	if e != nil {
		return
	}
	started = time.Now()
	code = "route_failed"
	if e = p.Engine.Route(ctx, d.App, fresh); e != nil {
		p.mu.Lock()
		if old.AppID != "" {
			p.running[d.App.AppId] = old
		} else {
			delete(p.running, d.App.AppId)
		}
		if prior != nil {
			p.desired[d.App.AppId] = prior
		} else {
			delete(p.desired, d.App.AppId)
		}
		delete(p.pending, d.App.AppId)
		p.persistLocked(d.App.AppId)
		p.mu.Unlock()
		return
	}
	stage("route", started)
	// Route is the commit point; cancellation after this cannot delete the live version.
	committed = true
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 45*time.Second)
	defer cancel()
	if len(old.Containers) == 0 || p.Engine.Remove(cleanup, old) == nil {
		p.mu.Lock()
		delete(p.pending, d.App.AppId)
		p.persistLocked(d.App.AppId)
		p.mu.Unlock()
	}

	success = true
	status("success")
}
func (p *Pipeline) reconcile(ctx context.Context) {
	if p.UpdatePending != nil && p.UpdatePending() {
		return
	}
	defer func() { p.mu.Lock(); p.ready = true; p.mu.Unlock() }()
	p.mu.Lock()
	if p.UpdatePending != nil && p.UpdatePending() {
		p.mu.Unlock()
		return
	}
	orphans := []Running{}
	for id, r := range p.running {
		if _, ok := p.desired[id]; !ok && !p.apps[id] {
			orphans = append(orphans, r)
		}
	}
	p.mu.Unlock()
	for _, r := range orphans {
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		if p.Engine.Stop(c, r) == nil && p.Engine.Remove(c, r) == nil {
			p.mu.Lock()
			delete(p.running, r.AppID)
			delete(p.pending, r.AppID)
			p.persistLocked(r.AppID)
			p.mu.Unlock()
		}
		cancel()
	}
	p.mu.Lock()
	desired := make([]*agentv1.AppConfig, 0, len(p.desired))
	for _, a := range p.desired {
		if !p.apps[a.AppId] {
			p.apps[a.AppId] = true
			desired = append(desired, proto.Clone(a).(*agentv1.AppConfig))
		}
	}
	p.mu.Unlock()
	for _, cfg := range desired {
		func() {
			defer func() { p.mu.Lock(); delete(p.apps, cfg.AppId); p.mu.Unlock() }()
			c, cancel := context.WithTimeout(ctx, 60*time.Second)
			defer cancel()
			p.mu.Lock()
			r, ok := p.running[cfg.AppId]
			p.mu.Unlock()
			if !ok {
				return
			}
			if cfg.Stopped {
				_ = p.Engine.Stop(c, r)
				return
			}
			alive, e := p.Engine.Inspect(c, r)
			if e != nil {
				return
			}
			if !alive || r.Revision != cfg.Revision || len(r.Containers) != int(cfg.Replicas) {
				fresh, e := p.Engine.Start(c, cfg, r.Image)
				if e != nil {
					return
				}
				fresh.SHA = r.SHA
				fresh.DeployID = r.DeployID
				fresh.Revision = cfg.Revision
				if e = p.Engine.Health(c, cfg, fresh); e != nil {
					_ = p.Engine.Remove(c, fresh)
					return
				}
				if e = p.Engine.Route(c, cfg, fresh); e != nil {
					_ = p.Engine.Remove(c, fresh)
					return
				}
				p.mu.Lock()
				p.running[cfg.AppId] = fresh
				p.persistLocked(cfg.AppId)
				p.mu.Unlock()
				_ = p.Engine.Remove(c, r)
			} else {
				if p.Engine.Health(c, cfg, r) == nil && p.Engine.Route(c, cfg, r) == nil {
					p.mu.Lock()
					old, pending := p.pending[cfg.AppId]
					p.mu.Unlock()
					if pending && (len(old.Containers) == 0 || p.Engine.Remove(c, old) == nil) {
						p.mu.Lock()
						delete(p.pending, cfg.AppId)
						p.persistLocked(cfg.AppId)
						p.mu.Unlock()
					}
				}
			}
		}()
	}
}

type StateStore struct {
	Path  string
	Vault *security.Vault
}
type persisted struct {
	Desired map[string]*agentv1.AppConfig `json:"desired"`
	Running map[string]Running            `json:"running"`
	Pending map[string]Running            `json:"pending"`
}

// persistLocked saves state where the in-memory change already happened and the
// next save retries it, so a failure is logged instead of returned.
func (p *Pipeline) persistLocked(app string) {
	if e := p.saveLocked(); e != nil {
		slog.Warn("agent state not saved", "app", app, "err", e)
	}
}
func (p *Pipeline) saveLocked() error {
	if p.State == nil {
		return nil
	}
	return p.State.Save(persisted{Desired: p.desired, Running: p.running, Pending: p.pending})
}
func (p *Pipeline) load() error {
	if p.State == nil {
		return nil
	}
	s, e := p.State.Load()
	if e != nil {
		return e
	}
	if s.Desired != nil {
		p.desired = s.Desired
	}
	if s.Pending != nil {
		p.pending = s.Pending
	}
	if s.Running != nil {
		p.running = s.Running
	}
	return nil
}
func (s *StateStore) Save(v persisted) error {
	b, e := protoJSON(v)
	if e != nil {
		return e
	}
	b, e = s.Vault.Seal(b, "agent-state")
	if e != nil {
		return e
	}
	return host.WriteFileAtomic(s.Path, b, 0600)
}

func (p *Pipeline) Observed() []*agentv1.ObservedApp {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]*agentv1.ObservedApp, 0, len(p.running))
	for _, r := range p.running {
		if p.apps[r.AppID] {
			continue
		}
		if _, pending := p.pending[r.AppID]; pending {
			continue
		}
		out = append(out, &agentv1.ObservedApp{AppId: r.AppID, DeployId: r.DeployID, Sha: r.SHA, Revision: r.Revision})
	}
	return out
}

func (p *Pipeline) Ready() bool { p.mu.Lock(); defer p.mu.Unlock(); return p.ready }

func (p *Pipeline) RequestUpdate(id, version string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.active) > 0 || len(p.apps) > 0 {
		return "busy"
	}
	if p.QueueUpdate == nil || p.QueueUpdate(id, version) != nil {
		return "failed"
	}
	return "queued"
}

func (p *Pipeline) Idle() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.active) == 0 && len(p.apps) == 0
}

// appOutputLines is how much of the app's own output a failed health check
// copies into the deployment log.
const appOutputLines = 20

// appOutput copies the last lines the new container printed into the
// deployment log, prefixed with "[app]". They usually say why it didn't answer,
// for example the port it actually listens on. The log is masked like the rest.
func appOutput(ctx context.Context, engine Engine, r Running, log func([]byte)) {
	read, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var b bytes.Buffer
	_ = engine.Logs(read, r, 0, false, func(chunk []byte) {
		if b.Len() < 1<<20 {
			b.Write(chunk)
		}
	})
	lines := strings.Split(strings.TrimRight(b.String(), "\n"), "\n")
	if len(lines) > appOutputLines {
		lines = lines[len(lines)-appOutputLines:]
	}
	for _, line := range lines {
		if line = strings.TrimRight(line, "\r"); line != "" {
			log([]byte("[app] " + line + "\n"))
		}
	}
}

// healthCode classifies a failed health check: the app exited, never answered
// (usually the wrong port), or answered with an error status.
func healthCode(ctx context.Context, engine Engine, r Running, err error) string {
	inspect, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if alive, e := engine.Inspect(inspect, r); e == nil && !alive {
		return "app_exited"
	}
	var h *HealthError
	if errors.As(err, &h) && h.Status != 0 {
		return "health_status_" + strconv.Itoa(h.Status)
	}
	return "health_no_response"
}
