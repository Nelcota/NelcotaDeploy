package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/Nelcota/NelcotaDeploy/internal/agent"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/provision"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
	"github.com/Nelcota/NelcotaDeploy/internal/updater"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"
	"time"
)

func main() {
	// Prefer the measured small working set; explicit GOGC remains authoritative.
	if os.Getenv("GOGC") == "" {
		debug.SetGCPercent(50)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if e := command().ExecuteContext(ctx); e != nil && !errors.Is(e, context.Canceled) {
		slog.Error("agent startup failed; check configuration, permissions, and local services")
		os.Exit(1)
	}
}
func command() *cobra.Command {
	var dir, data, bk, caddy, wg, diag string
	root := &cobra.Command{Use: "nelcota-agent", SilenceErrors: true, SilenceUsage: true}
	f := root.PersistentFlags()
	f.StringVar(&dir, "config-dir", "/etc/nelcota-agent", "Agent keys")
	f.StringVar(&data, "data-dir", "/var/lib/nelcota-agent", "Persistent state")
	f.StringVar(&bk, "buildkit", "unix:///run/buildkit/buildkitd.sock", "Local BuildKit socket")
	f.StringVar(&caddy, "caddy-admin", "http://127.0.0.1:2019", "Local Caddy admin API")
	f.StringVar(&wg, "wg-interface", "wg0", "WireGuard interface")
	f.StringVar(&diag, "pprof-listen", "", "Diagnostics on WireGuard")
	var panel, tokenFile, pubFile string
	join := &cobra.Command{Use: "join", RunE: func(cmd *cobra.Command, _ []string) error {
		return enroll(cmd.Context(), dir, panel, tokenFile, pubFile)
	}}
	join.Flags().StringVar(&panel, "panel-url", "", "Panel HTTPS origin")
	join.Flags().StringVar(&tokenFile, "join-token-file", "", "Mode 0600 invitation file")
	join.Flags().StringVar(&pubFile, "wg-public-key-file", "", "WireGuard public key file")
	_ = join.MarkFlagRequired("panel-url")
	_ = join.MarkFlagRequired("join-token-file")
	_ = join.MarkFlagRequired("wg-public-key-file")
	root.AddCommand(join)
	root.AddCommand(&cobra.Command{Use: "serve", RunE: func(cmd *cobra.Command, _ []string) error {
		ctx := cmd.Context()
		b, e := host.ReadSecret(filepath.Join(dir, "join.json"))
		if e != nil {
			return e
		}
		var join provision.JoinResult
		if e = json.Unmarshal(b, &join); e != nil {
			return e
		}
		if e = host.RequireInterface(join.Address+":8443", wg); e != nil {
			return e
		}
		key, e := security.LoadKey(filepath.Join(dir, "master.key"))
		if e != nil {
			return e
		}
		vault, e := security.NewVault(key)
		if e != nil {
			return e
		}
		tls, e := security.TLSConfig([]byte(join.Certificate), []byte(join.PrivateKey), []byte(join.CA), false)
		if e != nil {
			return e
		}
		certificates, e := security.NewCertificates(filepath.Join(data, "client-certificate.json"), join.ServerID, false, []byte(join.CA), security.CertificateBundle{Certificate: join.Certificate, PrivateKey: join.PrivateKey})
		if e != nil {
			return e
		}
		tls.Certificates = nil
		tls.GetClientCertificate = certificates.GetClientCertificate
		sign, e := base64.RawStdEncoding.DecodeString(join.SigningKey)
		if e != nil || len(sign) != ed25519.PublicKeySize {
			return errors.New("invalid signing key")
		}
		engine, e := agent.NewDockerEngine(ctx, bk, caddy, join.CacheBytes)
		if e != nil {
			return e
		}
		defer engine.Close()
		engine.BaseImagesPath = filepath.Join(data, "base-images.json")
		pipeline, e := agent.NewPipeline(engine, &agent.StateStore{Path: filepath.Join(data, "state.bin"), Vault: vault}, filepath.Join(data, "builds"), int(join.BuildLimit))
		if e != nil {
			return e
		}
		stats := func(ctx context.Context) *agentv1.Metrics { return engine.Metrics(ctx, data) }
		pipeline.Stats = stats
		pipeline.OnDeployFinished = func(id string, elapsed time.Duration) {
			host.CaptureSlow(filepath.Join(data, "traces"), id, elapsed, 2*time.Minute)
		}
		pipeline.QueueUpdate = func(id, version string) error { return updater.Queue(data, updater.Request{ID: id, Version: version}) }
		pipeline.UpdatePending = func() bool { return updater.PendingFor(data, updater.Version) }
		g, gctx := errgroup.WithContext(ctx)
		rpc := &transport.AgentClient{HeartbeatSent: func(ready bool) { _ = updater.WriteHealth(data, updater.Version, ready) }, Version: updater.Version, UpdateResult: func() *agentv1.OperationResult {
			r := updater.ReadResult(data)
			return &agentv1.OperationResult{Id: r.ID, Status: r.Status}
		}, URL: join.ControlURL, ServerID: join.ServerID, TLS: tls, Verifier: &security.Verifier{Key: ed25519.PublicKey(sign), ServerID: join.ServerID, Path: filepath.Join(data, "replay.json")}, Handler: pipeline, Metrics: stats, Active: pipeline.Active, Observed: pipeline.Observed, Ready: pipeline.Ready, Events: engine.Watch}
		// Warm telemetry descriptors once, then discard startup scratch pages.
		_ = stats(ctx)
		// Discard the bounded startup working set before entering the steady loop.
		debug.FreeOSMemory()
		g.Go(func() error { return pipeline.Run(gctx) })
		g.Go(func() error {
			return updater.RunRequests(gctx, data, func(_ context.Context, r updater.Request) (bool, error) {
				if e := transport.PrepareAgentUpdate(gctx, join.ControlURL, tls, r); e != nil {
					if errors.Is(e, transport.ErrAgentRejected) {
						return false, e
					}
					return false, nil
				}
				return true, nil
			}, func(error) { slog.Warn("local update request failed") })
		})
		g.Go(func() error {
			return engine.RunMaintenance(gctx, func() bool { return pipeline.Ready() && len(pipeline.Active()) == 0 && !updater.Pending(data) }, func(error) { slog.Warn("base image update failed") })
		})
		g.Go(func() error { return rpc.Run(gctx) })
		g.Go(func() error {
			return transport.RunCertificateRenewal(gctx, join.ControlURL, tls, certificates, func(error) { slog.Warn("certificate renewal failed") })
		})
		g.Go(func() error { return host.Diagnostics(gctx, diag, wg) })
		return g.Wait()
	}})
	root.AddCommand(updater.Commands("agent", &data)...)
	return root
}
func enroll(ctx context.Context, dir, panel, tokenFile, pubFile string) error {
	u, e := url.Parse(panel)
	if e != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("HTTPS panel URL required")
	}
	token, e := host.ReadSecret(tokenFile)
	if e != nil {
		return e
	}
	pub, e := os.ReadFile(pubFile)
	if e != nil {
		return e
	}
	b, e := json.Marshal(provision.JoinInput{Token: strings.TrimSpace(string(token)), WireGuardPublicKey: strings.TrimSpace(string(pub))})
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(panel, "/")+"/api/servers/join", bytes.NewReader(b))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return errors.New("enrollment network failure")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("enrollment rejected")
	}
	b, e = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if e != nil {
		return e
	}
	var result provision.JoinResult
	if e = json.Unmarshal(b, &result); e != nil {
		return e
	}
	if _, e = security.TLSConfig([]byte(result.Certificate), []byte(result.PrivateKey), []byte(result.CA), false); e != nil {
		return e
	}
	if e = host.WriteExclusive(filepath.Join(dir, "join.json"), b); e != nil {
		return e
	}
	key := make([]byte, 32)
	if _, e = rand.Read(key); e != nil {
		return e
	}
	return host.WriteExclusive(filepath.Join(dir, "master.key"), key)
}
