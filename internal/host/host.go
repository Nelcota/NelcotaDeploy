package host

import (
	"context"
	"errors"
	"github.com/VictoriaMetrics/metrics"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"path/filepath"
	"time"
)

func Serve(ctx context.Context, server *http.Server, tls bool) error {
	stop := context.AfterFunc(ctx, func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(c)
		_ = server.Close()
	})
	defer stop()
	var e error
	if tls {
		e = server.ListenAndServeTLS("", "")
	} else {
		e = server.ListenAndServe()
	}
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
func Server(address string, handler http.Handler) *http.Server {
	return &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
}
func RequireInterface(address, device string) error {
	host, _, e := net.SplitHostPort(address)
	if e != nil {
		return e
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsUnspecified() {
		return errors.New("explicit WireGuard address required")
	}
	iface, e := net.InterfaceByName(device)
	if e != nil {
		return errors.New("WireGuard interface missing")
	}
	addrs, e := iface.Addrs()
	if e != nil {
		return e
	}
	for _, a := range addrs {
		candidate, _, _ := net.ParseCIDR(a.String())
		if candidate.Equal(ip) {
			return nil
		}
	}
	return errors.New("listener address does not belong to WireGuard interface")
}
func Diagnostics(ctx context.Context, address, device string) error {
	if address == "" {
		<-ctx.Done()
		return nil
	}
	if e := RequireInterface(address, device); e != nil {
		return e
	}
	r := http.NewServeMux()
	r.HandleFunc("/debug/pprof/", pprof.Index)
	r.HandleFunc("/debug/pprof/profile", pprof.Profile)
	r.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	r.HandleFunc("/debug/pprof/trace", pprof.Trace)
	r.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) { metrics.WritePrometheus(w, true) })
	return Serve(ctx, Server(address, r), false)
}
func Metrics(ctx context.Context) *agentv1.Metrics {
	m := &agentv1.Metrics{}
	if v, e := cpu.PercentWithContext(ctx, 0, false); e == nil && len(v) > 0 {
		m.CpuPercent = v[0]
	}
	if v, e := mem.VirtualMemoryWithContext(ctx); e == nil {
		m.MemoryUsed = v.Used
		m.MemoryTotal = v.Total
	}
	if v, e := disk.UsageWithContext(ctx, "/var/lib/nelcota"); e == nil {
		m.DiskUsed = v.Used
		m.DiskTotal = v.Total
	}
	if v, e := gnet.IOCountersWithContext(ctx, false); e == nil && len(v) > 0 {
		m.NetworkRx = v[0].BytesRecv
		m.NetworkTx = v[0].BytesSent
	}
	return m
}
func Read(path string) ([]byte, error) { return os.ReadFile(path) }
func WriteExclusive(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	_, e = f.Write(b)
	return e
}
