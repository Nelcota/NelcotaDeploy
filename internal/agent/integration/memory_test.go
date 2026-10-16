//go:build integration

package integration

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/provision"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type memorySink struct {
	broker  *transport.Broker
	samples atomic.Int64
}

func (s *memorySink) AgentConnected(context.Context, transport.Peer) error { return nil }
func (s *memorySink) AgentDisconnected(context.Context, transport.Peer)    {}
func (s *memorySink) AgentEvent(ctx context.Context, p transport.Peer, e *agentv1.Event) error {
	if e.GetMetrics() != nil {
		s.samples.Add(1)
	}
	if h := e.GetHeartbeat(); h != nil && h.RequestState {
		return s.broker.Send(ctx, p.ID, &agentv1.Command{Desired: &agentv1.Snapshot{Limits: &agentv1.ServerLimits{BuildLimit: 1, CacheBytes: 128 << 20}}})
	}
	return nil
}
func verifyAgentMemory(t *testing.T, ctx context.Context, buildkit, caddy string) {
	t.Helper()
	root, e := filepath.Abs("../../..")
	if e != nil {
		t.Fatal(e)
	}
	binary := filepath.Join(t.TempDir(), "nelcota-agent")
	build := exec.CommandContext(ctx, "go", "build", "-trimpath", "-ldflags=-s -w", "-o", binary, "./cmd/nelcota-agent")
	build.Dir = root
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if b, e := build.CombinedOutput(); e != nil {
		t.Fatal(string(b), e)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	ca, _ := security.NewAuthority(time.Now())
	caPEM, _, _ := ca.PEM()
	sc, sk, _ := ca.Issue("127.0.0.1", true, time.Now())
	cert, private, _ := ca.Issue("memory-agent", false, time.Now())
	tls, _ := security.TLSConfig(sc, sk, caPEM, true)
	broker := transport.NewBroker(key)
	sink := &memorySink{broker: broker}
	broker.Sink = sink
	_, handler := broker.Handler()
	server := httptest.NewUnstartedServer(handler)
	server.TLS = tls
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	config, data := t.TempDir(), t.TempDir()
	join := provision.JoinResult{ServerID: "memory-agent", Address: "127.0.0.1", ControlURL: server.URL, CA: string(caPEM), Certificate: string(cert), PrivateKey: string(private), SigningKey: base64.RawStdEncoding.EncodeToString(pub), BuildLimit: 1, CacheBytes: 128 << 20}
	j, _ := json.Marshal(join)
	_ = os.WriteFile(filepath.Join(config, "join.json"), j, 0600)
	_ = os.WriteFile(filepath.Join(config, "master.key"), make([]byte, 32), 0600)
	profileURL := ""
	diagArgs := []string{}
	if os.Getenv("AGENT_MEMORY_PROFILE_FILE") != "" {
		listener, e := net.Listen("tcp", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		address := listener.Addr().String()
		_ = listener.Close()
		profileURL = "http://" + address
		diagArgs = []string{"--pprof-listen", address}
	}
	process := exec.CommandContext(ctx, binary, "serve", "--config-dir", config, "--data-dir", data, "--wg-interface", "lo", "--buildkit", buildkit, "--caddy-admin", caddy)
	process.Args = append(process.Args, diagArgs...)
	if value := os.Getenv("AGENT_MEMORY_GOMAXPROCS"); value != "" {
		process.Env = append(os.Environ(), "GOMAXPROCS="+value)
	}
	if e = process.Start(); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	defer func() {
		_ = process.Process.Signal(syscall.SIGTERM)
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = process.Process.Kill()
			<-done
			t.Error("agent did not stop")
		}
	}()
	deadline := time.NewTimer(40 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for sink.samples.Load() < 2 {
		select {
		case e := <-done:
			done <- e
			t.Fatal("agent exited before warmup", e)
		case <-deadline.C:
			t.Fatal("agent telemetry did not warm up")
		case <-tick.C:
		}
	}
	status, e := os.ReadFile("/proc/" + strconv.Itoa(process.Process.Pid) + "/status")
	if e != nil {
		t.Fatal(e)
	}
	var rss int64
	for _, line := range strings.Split(string(status), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			rss, _ = strconv.ParseInt(strings.Fields(line)[1], 10, 64)
		}
	}
	if profileURL != "" {
		smaps, _ := os.ReadFile("/proc/" + strconv.Itoa(process.Process.Pid) + "/smaps")
		_ = os.WriteFile(os.Getenv("AGENT_MEMORY_PROFILE_FILE")+".smaps", smaps, 0600)
		res, e := http.Get(profileURL + "/debug/pprof/heap?gc=1")
		if e != nil {
			t.Fatal(e)
		}
		profile, e := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(os.Getenv("AGENT_MEMORY_PROFILE_FILE"), profile, 0600); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("agent RSS after two real telemetry samples: %.1f MiB (GOMAXPROCS=%s)", float64(rss)/1024, os.Getenv("AGENT_MEMORY_GOMAXPROCS"))
	if rss <= 0 || rss > 64*1024 {
		t.Fatal("agent idle memory regression", rss)
	}
}
