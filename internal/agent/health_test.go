package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
)

func TestHealthNeverUsesOutboundProxy(t *testing.T) {
	var proxyHits atomic.Int64
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { proxyHits.Add(1); w.WriteHeader(502) }))
	defer proxy.Close()
	proxyURL, _ := url.Parse(proxy.URL)
	original := http.DefaultTransport
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	http.DefaultTransport = transport
	t.Cleanup(func() {
		http.DefaultTransport = original
		transport.CloseIdleConnections()
		healthTransport.CloseIdleConnections()
	})
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer target.Close()
	engine := &DockerEngine{}
	app := &agentv1.AppConfig{HealthPath: "/", HealthTimeoutSeconds: 1}
	if err := engine.Health(context.Background(), app, Running{Addresses: []string{strings.TrimPrefix(target.URL, "http://")}}); err != nil {
		t.Fatal(err)
	}
	if proxyHits.Load() != 0 {
		t.Fatal("container health data reached outbound proxy")
	}
	if err := engine.Health(context.Background(), app, Running{}); err == nil {
		t.Fatal("empty deployment was considered healthy")
	}
}
