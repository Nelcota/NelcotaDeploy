//go:build integration

package agent

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyNative(t *testing.T) {
	binary := os.Getenv("CADDY_BIN")
	if binary == "" {
		var e error
		binary, e = exec.LookPath("caddy")
		if e != nil {
			t.Fatal("Caddy binary required for native integration")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	free := func() string {
		l, e := net.Listen("tcp", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		addr := l.Addr().String()
		l.Close()
		return addr
	}
	adminAddr, proxyAddr := free(), free()
	dir := t.TempDir()
	config := map[string]any{"admin": map[string]any{"listen": adminAddr}, "apps": map[string]any{"http": map[string]any{"servers": map[string]any{"nelcota": map[string]any{"listen": []string{proxyAddr}, "routes": []any{}, "automatic_https": map[string]any{"disable": true}}}}}}
	b, _ := json.Marshal(config)
	path := filepath.Join(dir, "caddy.json")
	if e := os.WriteFile(path, b, 0600); e != nil {
		t.Fatal(e)
	}
	procCtx, stop := context.WithCancel(ctx)
	cmd := exec.CommandContext(procCtx, binary, "run", "--config", path)
	cmd.Env = append(os.Environ(), "HOME="+dir, "XDG_CONFIG_HOME="+dir, "XDG_DATA_HOME="+dir)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if e := cmd.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { stop(); _ = cmd.Wait() }()
	admin := "http://" + adminAddr
	ready := false
	for range 100 {
		req, _ := http.NewRequestWithContext(ctx, "GET", admin+"/config/", nil)
		r, e := http.DefaultClient.Do(req)
		if e == nil {
			r.Body.Close()
			if r.StatusCode == 200 {
				ready = true
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(30 * time.Millisecond):
		}
	}
	if !ready {
		t.Fatal("Caddy not ready")
	}
	app := func(text string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(text)) }))
	}
	old, next := app("one"), app("two")
	defer old.Close()
	defer next.Close()
	proxy, e := NewCaddy(admin)
	if e != nil {
		t.Fatal(e)
	}
	assertRoute := func(want string) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "http://"+proxyAddr, nil)
		req.Host = "app.example.test"
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		b, e := io.ReadAll(resp.Body)
		if e != nil || string(b) != want {
			t.Fatalf("route: status=%d body=%q want=%q err=%v", resp.StatusCode, b, want, e)
		}
	}
	if e = proxy.Route(ctx, "app", []string{"app.example.test"}, []string{strings.TrimPrefix(old.URL, "http://")}); e != nil {
		t.Fatal("initial route:", e)
	}
	assertRoute("one")
	if e = proxy.Route(ctx, "app", []string{"app.example.test"}, []string{strings.TrimPrefix(next.URL, "http://")}); e != nil {
		t.Fatal("replace route:", e)
	}
	assertRoute("two")
	if e = proxy.Delete(ctx, "app"); e != nil {
		t.Fatal(e)
	}
	assertRoute("")
}
