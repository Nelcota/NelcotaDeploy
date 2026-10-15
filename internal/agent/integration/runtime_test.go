//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/containerd/errdefs"
	legacycontainer "github.com/docker/docker/api/types/container"
	"github.com/docker/go-connections/nat"
	"github.com/moby/moby/client"
	"github.com/nelcota/nelcota-deploy/internal/agent"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"google.golang.org/protobuf/proto"
)

// This test requires a local Linux Docker host, matching the agent's deployment model.
func TestDockerBuildKitCaddy(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	docker, e := client.New(client.FromEnv)
	if e != nil {
		t.Fatal(e)
	}
	defer docker.Close()
	if _, e = docker.Ping(ctx, client.PingOptions{}); e != nil {
		t.Fatal("Docker required:", e)
	}
	free := func() string {
		listener, e := net.Listen("tcp", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		addr := listener.Addr().String()
		listener.Close()
		return addr
	}
	adminAddr, proxyAddr := free(), free()
	config, _ := json.Marshal(map[string]any{"admin": map[string]any{"listen": adminAddr}, "apps": map[string]any{"http": map[string]any{"servers": map[string]any{"nelcota": map[string]any{"listen": []string{proxyAddr}, "routes": []any{}, "automatic_https": map[string]any{"disable": true}}}}}})
	caddy, e := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: "caddy:2.10.2", Files: []testcontainers.ContainerFile{{Reader: bytes.NewReader(config), ContainerFilePath: "/etc/caddy/caddy.json", FileMode: 0644}}, Cmd: []string{"caddy", "run", "--config", "/etc/caddy/caddy.json"}, HostConfigModifier: func(h *legacycontainer.HostConfig) { h.NetworkMode = "host" }, WaitingFor: wait.ForLog("serving initial configuration")}, Started: true})
	if e != nil {
		t.Fatal(e)
	}
	defer testcontainers.TerminateContainer(caddy)
	builder, e := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: "moby/buildkit:v0.34.0", ExposedPorts: []string{"1234/tcp"}, Privileged: true, Cmd: []string{"--addr", "tcp://0.0.0.0:1234"}, HostConfigModifier: func(h *legacycontainer.HostConfig) {
		h.Privileged = true
		h.PortBindings = nat.PortMap{nat.Port("1234/tcp"): []nat.PortBinding{{HostIP: "127.0.0.1"}}}
	}, WaitingFor: wait.ForListeningPort("1234/tcp")}, Started: true})
	if e != nil {
		t.Fatal(e)
	}
	defer testcontainers.TerminateContainer(builder)
	buildURL, e := builder.PortEndpoint(ctx, "1234/tcp", "tcp")
	if e != nil {
		t.Fatal(e)
	}
	engine, e := agent.NewDockerEngine(ctx, buildURL, "http://"+adminAddr, 128<<20)
	if e != nil {
		t.Fatal(e)
	}
	defer engine.Close()
	verifyAgentMemory(t, ctx, buildURL, "http://"+adminAddr)
	engine.Drain = 0
	engine.BaseImagesPath = filepath.Join(t.TempDir(), "bases.json")
	id := "integration-" + security.Token()
	app := &agentv1.AppConfig{AppId: id, Domains: []string{"integration.example.test"}, Port: 8080, MemoryBytes: 64 << 20, NanoCpus: 1e9, Replicas: 1, HealthPath: "/", HealthTimeoutSeconds: 20, Dockerfile: "Dockerfile", CacheEnabled: true}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		networks, e := docker.NetworkList(cleanup, client.NetworkListOptions{Filters: client.Filters{}.Add("label", "nelcota.app="+id)})
		if e == nil {
			for _, network := range networks.Items {
				_, _ = docker.NetworkRemove(cleanup, network.ID, client.NetworkRemoveOptions{})
			}
		}
	}()
	dir := t.TempDir()
	build := func(version string) string {
		t.Helper()
		dockerfile := "FROM busybox:1.37.0\nRUN mkdir -p /www && echo " + version + " > /www/index.html\nWORKDIR /www\nUSER 65532:65532\nCMD [\"httpd\",\"-f\",\"-p\",\"8080\"]\n"
		if e := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(dockerfile), 0600); e != nil {
			t.Fatal(e)
		}
		var buildLog bytes.Buffer
		image, e := engine.Build(ctx, &agentv1.Deploy{DeployId: security.Token(), App: app}, dir, func(b []byte) { _, _ = buildLog.Write(b) })
		if e != nil {
			t.Fatalf("%v\n%s", e, buildLog.String())
		}
		return image
	}
	remove := func(r agent.Running) {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		if e := engine.Remove(cleanup, r); e != nil {
			t.Error(e)
		}
	}
	oldImage := build("one")
	if e = engine.RefreshBases(ctx, time.Now(), nil); e != nil {
		t.Fatal(e)
	}
	catalog, e := os.ReadFile(engine.BaseImagesPath)
	if e != nil {
		t.Fatal(e)
	}
	var bases map[string]struct {
		Refreshed int64 `json:"refreshed"`
	}
	if e = json.Unmarshal(catalog, &bases); e != nil || bases["docker.io/library/busybox:1.37.0"].Refreshed == 0 {
		t.Fatal("BuildKit base was not prewarmed", string(catalog), e)
	}
	old, e := engine.Start(ctx, app, oldImage)
	if e != nil {
		t.Fatal(e)
	}
	defer remove(old)
	for _, id := range old.Containers {
		v, e := docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
		if e != nil {
			t.Fatal(e)
		}
		h := v.Container.HostConfig
		if h.Privileged || len(h.PortBindings) != 0 || v.Container.Config.User != "65532:65532" || !h.ReadonlyRootfs || len(h.CapDrop) != 1 || h.CapDrop[0] != "ALL" || len(h.SecurityOpt) == 0 || h.Memory != 64<<20 || h.NanoCPUs != 1e9 {
			t.Fatal("container hardening mismatch")
		}
	}
	metrics := engine.Metrics(ctx, dir)
	found := false
	for _, m := range metrics.Containers {
		if m.AppId == app.AppId {
			found = true
			if m.MemoryLimit != 64<<20 || m.Pids < 1 {
				t.Fatal("invalid real container metrics", m)
			}
		}
	}
	if !found {
		t.Fatal("managed container stats missing")
	}
	if e = engine.Health(ctx, app, old); e != nil {
		t.Fatal(e)
	}
	if e = engine.Route(ctx, app, old); e != nil {
		t.Fatal(e)
	}
	clientHTTP := &http.Client{Timeout: 2 * time.Second}
	read := func() (string, error) {
		req, e := http.NewRequestWithContext(ctx, "GET", "http://"+proxyAddr, nil)
		if e != nil {
			return "", e
		}
		req.Host = app.Domains[0]
		resp, e := clientHTTP.Do(req)
		if e != nil {
			return "", e
		}
		defer resp.Body.Close()
		b, e := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			return "", io.ErrUnexpectedEOF
		}
		return strings.TrimSpace(string(b)), e
	}
	if body, e := read(); e != nil || body != "one" {
		t.Fatal(body, e)
	}
	badConfig := proto.Clone(app).(*agentv1.AppConfig)
	badConfig.HealthPath = "/missing"
	badConfig.HealthTimeoutSeconds = 1
	bad, e := engine.Start(ctx, badConfig, oldImage)
	if e != nil {
		t.Fatal(e)
	}
	if e = engine.Health(ctx, badConfig, bad); e == nil {
		remove(bad)
		t.Fatal("bad healthcheck accepted")
	}
	remove(bad)
	if body, e := read(); e != nil || body != "one" {
		t.Fatal("failed candidate changed production", body, e)
	}
	var lost atomic.Int64
	loadCtx, stopLoad := context.WithCancel(ctx)
	loadDone := make(chan struct{})
	go func() {
		defer close(loadDone)
		for {
			select {
			case <-loadCtx.Done():
				return
			default:
				if body, e := read(); e != nil || (body != "one" && body != "two") {
					lost.Add(1)
				}
			}
		}
	}()
	defer func() { stopLoad(); <-loadDone }()
	freshImage := build("two")
	fresh, e := engine.Start(ctx, app, freshImage)
	if e != nil {
		t.Fatal(e)
	}
	defer remove(fresh)
	if e = engine.Health(ctx, app, fresh); e != nil {
		t.Fatal(e)
	}
	if e = engine.Route(ctx, app, fresh); e != nil {
		t.Fatal(e)
	}
	remove(old)
	if body, e := read(); e != nil || body != "two" {
		t.Fatal(body, e)
	}
	stopLoad()
	<-loadDone

	if lost.Load() != 0 {
		t.Fatal("requests lost in local swap test", lost.Load())
	}
	for _, id := range old.Containers {
		if _, e = docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{}); !errdefs.IsNotFound(e) {
			t.Fatal("old container retained", e)
		}
	}
	if _, e = docker.ImageInspect(ctx, oldImage); !errdefs.IsNotFound(e) {
		t.Fatal("old image retained", e)
	}
}
