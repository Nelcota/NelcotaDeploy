package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"

	"github.com/containerd/errdefs"
	bk "github.com/moby/buildkit/client"
	"github.com/moby/buildkit/session"
	"github.com/moby/buildkit/session/secrets/secretsprovider"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/tonistiigi/fsutil"
	"golang.org/x/sync/errgroup"
)

type DockerEngine struct {
	baseMu         sync.Mutex
	BaseImagesPath string
	cacheMu        sync.RWMutex
	statsMu        sync.Mutex
	previousStats  map[string]container.CPUStats
	Docker         *client.Client
	BuildKit       *bk.Client
	Caddy          *Caddy
	CacheBytes     int64
	Drain          time.Duration
	CgroupParent   string
}

func NewDockerEngine(ctx context.Context, buildkit, caddy string, cache int64) (*DockerEngine, error) {
	d, e := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if e != nil {
		return nil, e
	}
	b, e := bk.New(ctx, buildkit)
	if e != nil {
		_ = d.Close()
		return nil, e
	}
	proxy, e := NewCaddy(caddy)
	if e != nil {
		_ = d.Close()
		_ = b.Close()
		return nil, e
	}
	return &DockerEngine{Docker: d, BuildKit: b, Caddy: proxy, CacheBytes: cache, Drain: 5 * time.Second, CgroupParent: "nelcota-builds.slice"}, nil
}
func (d *DockerEngine) Close() { _ = d.Docker.Close(); _ = d.BuildKit.Close() }
func (d *DockerEngine) Clone(ctx context.Context, dep *agentv1.Deploy, dir string, log func([]byte)) error {
	u, e := url.Parse(dep.App.Repository)
	if e != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !shaRE.MatchString(dep.Sha) {
		return errors.New("invalid repository or SHA")
	}
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0"}
	if dep.GithubToken != "" {
		env = append(env, "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.https://github.com/.extraHeader", "GIT_CONFIG_VALUE_0=Authorization: Basic "+base64.StdEncoding.EncodeToString([]byte("x-access-token:"+dep.GithubToken)))
	}
	commands := [][]string{{"init", "--quiet", dir}, {"-C", dir, "fetch", "--quiet", "--depth=1", "--no-tags", dep.App.Repository, dep.Sha}, {"-C", dir, "checkout", "--quiet", "--detach", "FETCH_HEAD"}}
	for _, args := range commands {
		args = append([]string{"-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never"}, args...)
		cmd := exec.CommandContext(ctx, "git", args...)
		cmd.Env = env
		cmd.WaitDelay = 2 * time.Second
		cmd.Stdout = logWriter{log}
		cmd.Stderr = logWriter{log}
		e := cmd.Run()
		if e != nil {
			return errors.New("clone failed")
		}
	}
	verify := exec.CommandContext(ctx, "git", "-C", dir, "rev-parse", "HEAD")
	verify.Env = env
	actual, e := verify.Output()
	if e != nil || !strings.EqualFold(strings.TrimSpace(string(actual)), dep.Sha) {
		return errors.New("cloned SHA mismatch")
	}
	return nil
}
func (d *DockerEngine) Build(ctx context.Context, dep *agentv1.Deploy, dir string, log func([]byte)) (string, error) {
	dockerfile := dep.App.Dockerfile
	if dockerfile == "" {
		dockerfile = "Dockerfile"
	}
	resolved, e := filepath.EvalSymlinks(filepath.Join(dir, dockerfile))
	if e != nil {
		return "", errors.New("Dockerfile missing")
	}
	rel, e := filepath.Rel(dir, resolved)
	if e != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", errors.New("Dockerfile escapes build context")
	}
	tag := "nelcota/" + key(dep.App.AppId) + ":" + key(dep.DeployId)
	tar, e := os.CreateTemp("", "nelcota-image-*.tar")
	if e != nil {
		return "", e
	}
	name := tar.Name()
	_ = tar.Close()
	defer os.Remove(name)
	attrs := map[string]string{"image-resolve-mode": "pull", "filename": dockerfile, "cgroup-parent": d.CgroupParent, "force-network-mode": "sandbox", "label:nelcota.managed": "true", "label:nelcota.app": dep.App.AppId, "build-arg:BUILDKIT_CACHE_MOUNT_NS": key(dep.App.AppId)}
	if dep.Clean || !dep.App.CacheEnabled {
		attrs["no-cache"] = ""
		attrs["build-arg:BUILDKIT_CACHE_MOUNT_NS"] = key(dep.DeployId)
	}
	secretMap := map[string][]byte{}
	for k, v := range dep.App.BuildSecrets {
		secretMap[k] = []byte(v)
	}
	contextFS, e := fsutil.NewFS(dir)
	if e != nil {
		return "", e
	}
	options := bk.SolveOpt{Frontend: "dockerfile.v0", LocalMounts: map[string]fsutil.FS{"context": contextFS, "dockerfile": contextFS}, FrontendAttrs: attrs, SharedKey: key(dep.App.AppId), Session: []session.Attachable{secretsprovider.FromMap(secretMap)}, Exports: []bk.ExportEntry{{Type: "docker", Attrs: map[string]string{"name": tag}, Output: func(map[string]string) (io.WriteCloser, error) {
		return os.OpenFile(name, os.O_WRONLY|os.O_TRUNC, 0600)
	}}}}
	status := make(chan *bk.SolveStatus, 32)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		for s := range status {
			for _, l := range s.Logs {
				log(l.Data)
			}
		}
		return nil
	})
	g.Go(func() error { _, e := d.BuildKit.Solve(gctx, nil, options, status); return e })
	if e = g.Wait(); e != nil {
		log([]byte("[buildkit] " + e.Error() + "\n"))
		return "", errors.New("build failed")
	}
	f, e := os.Open(name)
	if e != nil {
		return "", e
	}
	defer f.Close()
	load, e := d.Docker.ImageLoad(ctx, f)
	if e != nil {
		return "", errors.New("image import failed")
	}
	defer load.Close()
	if _, e = io.Copy(io.Discard, load); e != nil {
		return "", e
	}
	if _, e = d.Docker.ImageInspect(ctx, tag); e != nil {
		return "", errors.New("image export unavailable")
	}
	if e = d.gc(ctx); e != nil {
		_, _ = d.Docker.ImageRemove(context.WithoutCancel(ctx), tag, client.ImageRemoveOptions{PruneChildren: true})
		return "", e
	}
	if e = d.recordBases(ctx, dir, dockerfile); e != nil {
		log([]byte("[maintenance] não foi possível registrar imagens base\n"))
	}
	return tag, nil
}
func HardenedConfig(app *agentv1.AppConfig, img string) (*container.Config, *container.HostConfig) {
	port := network.MustParsePort(strconv.FormatUint(uint64(app.Port), 10) + "/tcp")
	env := make([]string, 0, len(app.Env))
	for k, v := range app.Env {
		env = append(env, k+"="+v)
	}
	pids := int64(128)
	return &container.Config{Image: img, User: "65532:65532", Env: env, ExposedPorts: network.PortSet{port: {}}, Labels: map[string]string{"nelcota.managed": "true", "nelcota.app": app.AppId}}, &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Resources: container.Resources{Memory: app.MemoryBytes, NanoCPUs: app.NanoCpus, PidsLimit: &pids}, Tmpfs: map[string]string{"/tmp": "rw,noexec,nosuid,size=64m,uid=65532,gid=65532"}, RestartPolicy: container.RestartPolicy{Name: "unless-stopped"}, LogConfig: container.LogConfig{Type: "json-file", Config: map[string]string{"max-size": "10m", "max-file": "2"}}}
}
func (d *DockerEngine) Start(ctx context.Context, app *agentv1.AppConfig, img string) (Running, error) {
	r := Running{AppID: app.AppId, Image: img, Revision: app.Revision}
	if app.Replicas < 1 || app.Replicas > 16 || app.Port < 1 || app.Port > 65535 || app.MemoryBytes < 32<<20 || app.NanoCpus < 1e7 {
		return r, errors.New("invalid container configuration")
	}
	netName := "nelcota-" + key(app.AppId)
	networks, e := d.Docker.NetworkList(ctx, client.NetworkListOptions{Filters: client.Filters{}.Add("name", "^"+netName+"$")})
	if e != nil {
		return r, e
	}
	if len(networks.Items) == 0 {
		if _, e = d.Docker.NetworkCreate(ctx, netName, client.NetworkCreateOptions{Driver: "bridge", Labels: map[string]string{"nelcota.managed": "true", "nelcota.app": app.AppId}}); e != nil {
			return r, e
		}
	}
	for range app.Replicas {
		cfg, host := HardenedConfig(app, img)
		resp, e := d.Docker.ContainerCreate(ctx, client.ContainerCreateOptions{Config: cfg, HostConfig: host, NetworkingConfig: &network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{netName: {}}}, Name: "nelcota-" + key(app.AppId) + "-" + key(security.Token())})
		if e != nil {
			d.cleanupContainers(r)
			return r, e
		}
		r.Containers = append(r.Containers, resp.ID)
		if _, e = d.Docker.ContainerStart(ctx, resp.ID, client.ContainerStartOptions{}); e != nil {
			d.cleanupContainers(r)
			return r, e
		}
		inspect, e := d.Docker.ContainerInspect(ctx, resp.ID, client.ContainerInspectOptions{})
		if e != nil {
			d.cleanupContainers(r)
			return r, e
		}
		address := inspect.Container.NetworkSettings.Networks[netName].IPAddress
		r.Addresses = append(r.Addresses, net.JoinHostPort(address.String(), strconv.Itoa(int(app.Port))))
	}
	return r, nil
}
func (d *DockerEngine) cleanupContainers(r Running) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, id := range r.Containers {
		_, _ = d.Docker.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true, RemoveVolumes: true})
	}
}
func (d *DockerEngine) Health(ctx context.Context, app *agentv1.AppConfig, r Running) error {
	timeout := time.Duration(app.HealthTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, addr := range r.Addresses {
		for {
			req, e := http.NewRequestWithContext(ctx, "GET", "http://"+addr+app.HealthPath, nil)
			if e != nil {
				return e
			}
			resp, e := client.Do(req)
			if e == nil {
				_ = resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 400 {
					break
				}
			}
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return errors.New("healthcheck timed out")
			case <-timer.C:
			}
		}
	}
	return nil
}
func (d *DockerEngine) Route(ctx context.Context, app *agentv1.AppConfig, r Running) error {
	return d.Caddy.Route(ctx, app.AppId, app.Domains, r.Addresses)
}
func (d *DockerEngine) Remove(ctx context.Context, r Running) error {
	if len(r.Containers) > 0 {
		if d.Drain > 0 {
			timer := time.NewTimer(d.Drain)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		for _, id := range r.Containers {
			seconds := int(d.Drain.Seconds())
			_, _ = d.Docker.ContainerStop(ctx, id, client.ContainerStopOptions{Timeout: &seconds})
			if _, e := d.Docker.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true, RemoveVolumes: true}); e != nil && !errdefs.IsNotFound(e) {
				return e
			}
		}
	}
	if r.Image != "" {
		_, e := d.Docker.ImageRemove(ctx, r.Image, client.ImageRemoveOptions{PruneChildren: true})
		if e != nil && !errdefs.IsNotFound(e) && !errdefs.IsConflict(e) {
			return e
		}
	}
	return nil
}
func (d *DockerEngine) Inspect(ctx context.Context, r Running) (bool, error) {
	for _, id := range r.Containers {
		v, e := d.Docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
		if errdefs.IsNotFound(e) {
			return false, nil
		}
		if e != nil {
			return false, e
		}
		if !v.Container.State.Running {
			return false, nil
		}
	}
	return len(r.Containers) > 0, nil
}
func (d *DockerEngine) Stop(ctx context.Context, r Running) error {
	if e := d.Caddy.Delete(ctx, r.AppID); e != nil {
		return e
	}
	for _, id := range r.Containers {
		if _, e := d.Docker.ContainerStop(ctx, id, client.ContainerStopOptions{}); e != nil && !errdefs.IsNotFound(e) {
			return e
		}
	}
	return nil
}
func (d *DockerEngine) Restart(ctx context.Context, r Running) error {
	for _, id := range r.Containers {
		if _, e := d.Docker.ContainerRestart(ctx, id, client.ContainerRestartOptions{}); e != nil {
			return e
		}
	}
	return nil
}

type logWriter struct{ fn func([]byte) }

func (w logWriter) Write(b []byte) (int, error) { w.fn(b); return len(b), nil }
func (d *DockerEngine) Logs(ctx context.Context, r Running, since int64, follow bool, log func([]byte)) error {
	if len(r.Containers) == 0 {
		return errors.New("app not running")
	}
	body, e := d.Docker.ContainerLogs(ctx, r.Containers[0], client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Follow: follow, Since: strconv.FormatInt(since, 10), Tail: "1000"})
	if e != nil {
		return e
	}
	defer body.Close()
	_, e = stdcopy.StdCopy(logWriter{log}, logWriter{log}, body)
	return e
}
func (d *DockerEngine) Prune(ctx context.Context, scope agentv1.Prune_Scope) error {
	switch scope {
	case agentv1.Prune_CACHE:
		return d.BuildKit.Prune(ctx, nil, bk.PruneAll)
	case agentv1.Prune_ORPHAN_IMAGES:
		_, e := d.Docker.ImagePrune(ctx, client.ImagePruneOptions{Filters: client.Filters{}.Add("label", "nelcota.managed=true")})
		return e
	default:
		return errors.New("unknown prune scope")
	}
}

type Caddy struct {
	URL    string
	Client *http.Client
}

func NewCaddy(raw string) (*Caddy, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "http" || u.User != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
		return nil, errors.New("Caddy admin must be loopback HTTP")
	}
	return &Caddy{strings.TrimSuffix(raw, "/"), &http.Client{Timeout: 10 * time.Second}}, nil
}
func (c *Caddy) request(ctx context.Context, method, path string, v any) (int, error) {
	var body io.Reader
	if v != nil {
		b, e := json.Marshal(v)
		if e != nil {
			return 0, e
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, c.URL+path, body)
	if e != nil {
		return 0, e
	}
	req.Header.Set("Content-Type", "application/json")
	resp, e := c.Client.Do(req)
	if e != nil {
		return 0, e
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("Caddy returned HTTP %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}
func (c *Caddy) Route(ctx context.Context, id string, domains, addresses []string) error {
	if len(domains) == 0 || len(addresses) == 0 {
		return errors.New("domains and upstreams required")
	}
	ups := make([]map[string]string, 0, len(addresses))
	for _, a := range addresses {
		ups = append(ups, map[string]string{"dial": a})
	}
	route := map[string]any{"@id": "nelcota-" + key(id), "match": []any{map[string]any{"host": domains}}, "handle": []any{map[string]any{"handler": "encode", "encodings": map[string]any{"zstd": map[string]any{}, "gzip": map[string]any{}}}, map[string]any{"handler": "reverse_proxy", "upstreams": ups, "flush_interval": -1}}, "terminal": true}
	code, e := c.request(ctx, "PATCH", "/id/nelcota-"+key(id), route)
	if code == 404 {
		_, e = c.request(ctx, "POST", "/config/apps/http/servers/nelcota/routes", route)
	}
	return e
}
func (c *Caddy) Delete(ctx context.Context, id string) error {
	code, e := c.request(ctx, "DELETE", "/id/nelcota-"+key(id), nil)
	if code == 404 {
		return nil
	}
	return e
}

func (d *DockerEngine) Watch(ctx context.Context, emit func(*agentv1.Event) error) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		stream := d.Docker.Events(ctx, client.EventsListOptions{Filters: client.Filters{}.Add("type", "container").Add("label", "nelcota.managed=true")})
		alive := true
		for alive {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-stream.Err:
				alive = false
			case event := <-stream.Messages:
				if app := event.Actor.Attributes["nelcota.app"]; app != "" {
					_ = emit(&agentv1.Event{Payload: &agentv1.Event_ContainerEvent{ContainerEvent: &agentv1.ContainerEvent{AppId: app, ContainerId: event.Actor.ID, Status: string(event.Action)}}})
				}
			}
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (d *DockerEngine) gc(ctx context.Context) error {
	if e := d.BuildKit.Prune(ctx, nil, bk.WithKeepOpt(7*24*time.Hour, 0, 0, 0)); e != nil {
		return e
	}
	d.cacheMu.RLock()
	cache := d.CacheBytes
	d.cacheMu.RUnlock()
	return d.BuildKit.Prune(ctx, nil, bk.WithKeepOpt(0, 0, cache, 0))
}

func (d *DockerEngine) SetCacheLimit(bytes int64) {
	d.cacheMu.Lock()
	d.CacheBytes = bytes
	d.cacheMu.Unlock()
}
