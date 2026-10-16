package agent

import (
	"context"
	"errors"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	bk "github.com/moby/buildkit/client"
	"go.uber.org/goleak"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

type fakeEngine struct {
	mu          sync.Mutex
	healthErr   error
	buildError  bool
	exited      bool
	healthError bool
	block       bool
	routed      bool
	removed     []string
}

func (f *fakeEngine) Clone(ctx context.Context, _ *agentv1.Deploy, _ string, _ func([]byte)) error {
	if f.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}
func (f *fakeEngine) Build(context.Context, *agentv1.Deploy, string, func([]byte)) (string, error) {
	if f.buildError {
		return "", errors.New("build failed")
	}
	return "new-image", nil
}
func (f *fakeEngine) Start(context.Context, *agentv1.AppConfig, string) (Running, error) {
	return Running{AppID: "app", Image: "new-image", Containers: []string{"new"}, Addresses: []string{"127.0.0.1:1"}}, nil
}
func (f *fakeEngine) Health(context.Context, *agentv1.AppConfig, Running) error {
	if f.healthErr != nil {
		return f.healthErr
	}
	if f.healthError {
		return errors.New("unhealthy")
	}
	return nil
}
func (f *fakeEngine) Route(context.Context, *agentv1.AppConfig, Running) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.routed = true
	return nil
}
func (f *fakeEngine) Remove(_ context.Context, r Running) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, r.Containers...)
	return nil
}
func (f *fakeEngine) Inspect(context.Context, Running) (bool, error)                 { return !f.exited, nil }
func (f *fakeEngine) Stop(context.Context, Running) error                            { return nil }
func (f *fakeEngine) Restart(context.Context, Running) error                         { return nil }
func (f *fakeEngine) Logs(context.Context, Running, int64, bool, func([]byte)) error { return nil }
func (f *fakeEngine) Prune(context.Context, agentv1.Prune_Scope) error               { return nil }
func TestHealthFailureKeepsOld(t *testing.T) {
	f := &fakeEngine{healthError: true}
	p, _ := NewPipeline(f, nil, t.TempDir(), 1)
	p.running["app"] = Running{Containers: []string{"old"}, Image: "old-image"}
	var statuses []string
	p.deploy(context.Background(), &agentv1.Deploy{DeployId: "deploy", Sha: strings.Repeat("a", 40), App: &agentv1.AppConfig{AppId: "app"}}, func(e *agentv1.Event) error {
		if s := e.GetDeployStatus(); s != nil {
			statuses = append(statuses, s.Status)
		}
		return nil
	})
	if f.routed || len(f.removed) != 1 || f.removed[0] != "new" {
		t.Fatal(f.routed, f.removed)
	}
	if statuses[len(statuses)-1] != "failed" {
		t.Fatal(statuses)
	}
	entries, _ := os.ReadDir(p.Root)
	if len(entries) != 0 {
		t.Fatal("source not removed")
	}
}
func TestSuccessSwitchesBeforeRetirement(t *testing.T) {
	f := &fakeEngine{}
	p, _ := NewPipeline(f, nil, t.TempDir(), 1)
	p.running["app"] = Running{Containers: []string{"old"}, Image: "old-image"}
	p.deploy(context.Background(), &agentv1.Deploy{DeployId: "deploy", Sha: strings.Repeat("a", 40), App: &agentv1.AppConfig{AppId: "app"}}, func(*agentv1.Event) error { return nil })
	if !f.routed || len(f.removed) != 1 || f.removed[0] != "old" {
		t.Fatal(f.routed, f.removed)
	}
}
func TestCancellationAndCapacity(t *testing.T) {
	f := &fakeEngine{block: true}
	p, _ := NewPipeline(f, nil, t.TempDir(), 1)
	ctx, cancel := context.WithCancel(context.Background())
	dep := &agentv1.Deploy{DeployId: "d1", Sha: strings.Repeat("a", 40), App: &agentv1.AppConfig{AppId: "app"}}
	if e := p.launch(ctx, dep, func(*agentv1.Event) error { return nil }); e != nil {
		t.Fatal(e)
	}
	dep2 := &agentv1.Deploy{DeployId: "d2", Sha: dep.Sha, App: dep.App}
	if e := p.launch(ctx, dep2, func(*agentv1.Event) error { return nil }); e == nil {
		t.Fatal("concurrent app build allowed")
	}
	cancel()
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancel did not terminate clone")
	}
}
func TestHardening(t *testing.T) {
	cfg, host := HardenedConfig(&agentv1.AppConfig{AppId: "app", Port: 8080, MemoryBytes: 256 << 20, NanoCpus: 1e9}, "image")
	if cfg.User == "" || cfg.User == "0" || len(host.PortBindings) != 0 || len(host.Binds) != 0 || !host.ReadonlyRootfs || len(host.CapDrop) != 1 || host.CapDrop[0] != "ALL" {
		t.Fatal("unsafe config")
	}
	if host.SecurityOpt[0] != "no-new-privileges:true" {
		t.Fatal(host.SecurityOpt)
	}
}

func TestEncryptedStateAndPendingRecovery(t *testing.T) {
	vault, e := security.NewVault(make([]byte, 32))
	if e != nil {
		t.Fatal(e)
	}
	state := &StateStore{Path: filepath.Join(t.TempDir(), "state.bin"), Vault: vault}
	v := persisted{Desired: map[string]*agentv1.AppConfig{"app": {AppId: "app", Replicas: 1, Env: map[string]string{"TOKEN": "private-test-value"}}}, Running: map[string]Running{"app": {AppID: "app", Image: "new-image", Containers: []string{"new"}}}, Pending: map[string]Running{"app": {AppID: "app", Image: "old-image", Containers: []string{"old"}}}}
	if e = state.Save(v); e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(state.Path)
	if e != nil || strings.Contains(string(raw), "private-test-value") {
		t.Fatal("state not encrypted", e)
	}
	engine := &fakeEngine{}
	p, e := NewPipeline(engine, state, t.TempDir(), 1)
	if e != nil {
		t.Fatal(e)
	}
	p.reconcile(context.Background())
	if !engine.routed || len(engine.removed) != 1 || engine.removed[0] != "old" || !p.Ready() {
		t.Fatal("pending switch not recovered")
	}
	after, e := state.Load()
	if e != nil || len(after.Pending) != 0 {
		t.Fatal("pending record not cleared", e)
	}
}

func TestFailureCodesNameTheStep(t *testing.T) {
	for _, row := range []struct {
		engine *fakeEngine
		want   string
	}{
		{&fakeEngine{buildError: true}, "build_failed"},
		{&fakeEngine{healthErr: &HealthError{}}, "health_no_response"},
		{&fakeEngine{healthErr: &HealthError{Status: 502}}, "health_status_502"},
		{&fakeEngine{healthErr: &HealthError{}, exited: true}, "app_exited"},
	} {
		p, _ := NewPipeline(row.engine, nil, t.TempDir(), 1)
		var code, status string
		p.deploy(context.Background(), &agentv1.Deploy{DeployId: "d", Sha: strings.Repeat("a", 40), App: &agentv1.AppConfig{AppId: "app"}}, func(e *agentv1.Event) error {
			if s := e.GetDeployStatus(); s != nil && s.Status != "" {
				status, code = s.Status, s.ErrorCode
			}
			return nil
		})
		if status != "failed" || code != row.want {
			t.Fatal(row.want, status, code)
		}
	}
}

func TestHealthErrorMessages(t *testing.T) {
	if (&HealthError{}).Error() == (&HealthError{Status: 500}).Error() {
		t.Fatal("messages should differ")
	}
}

func TestCacheTotal(t *testing.T) {
	if got := cacheTotal([]*bk.UsageInfo{{Size: 10}, nil, {Size: -1}, {Size: 5, Shared: true}}); got != 15 {
		t.Fatal(got)
	}
	if (&DockerEngine{}).buildCacheUsed(context.Background()) != 0 {
		t.Fatal("no BuildKit client should report zero")
	}
}
