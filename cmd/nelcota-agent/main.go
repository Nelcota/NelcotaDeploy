package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/nelcota/nelcota-deploy/internal/agent"
	"github.com/nelcota/nelcota-deploy/internal/host"
	"github.com/nelcota/nelcota-deploy/internal/provision"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if e := command().ExecuteContext(ctx); e != nil && !errors.Is(e, context.Canceled) {
		slog.Error("agent não iniciado; verifique configuração, permissões e serviços locais")
		os.Exit(1)
	}
}
func command() *cobra.Command {
	var dir, data, bk, caddy, wg, diag string
	root := &cobra.Command{Use: "nelcota-agent", SilenceErrors: true, SilenceUsage: true}
	f := root.PersistentFlags()
	f.StringVar(&dir, "config-dir", "/etc/nelcota-agent", "Chaves do agent")
	f.StringVar(&data, "data-dir", "/var/lib/nelcota-agent", "Estado persistente")
	f.StringVar(&bk, "buildkit", "unix:///run/buildkit/buildkitd.sock", "Socket local BuildKit")
	f.StringVar(&caddy, "caddy-admin", "http://127.0.0.1:2019", "API admin local do Caddy")
	f.StringVar(&wg, "wg-interface", "wg0", "Interface WireGuard")
	f.StringVar(&diag, "pprof-listen", "", "Diagnósticos no WireGuard")
	var panel, tokenFile, pubFile string
	join := &cobra.Command{Use: "join", RunE: func(cmd *cobra.Command, _ []string) error {
		return enroll(cmd.Context(), dir, panel, tokenFile, pubFile)
	}}
	join.Flags().StringVar(&panel, "panel-url", "", "Origem HTTPS do painel")
	join.Flags().StringVar(&tokenFile, "join-token-file", "", "Arquivo 0600 com convite")
	join.Flags().StringVar(&pubFile, "wg-public-key-file", "", "Arquivo com chave pública WireGuard")
	_ = join.MarkFlagRequired("panel-url")
	_ = join.MarkFlagRequired("join-token-file")
	_ = join.MarkFlagRequired("wg-public-key-file")
	root.AddCommand(join)
	root.AddCommand(&cobra.Command{Use: "serve", RunE: func(cmd *cobra.Command, _ []string) error {
		ctx := cmd.Context()
		b, e := os.ReadFile(filepath.Join(dir, "join.json"))
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
		sign, e := base64.RawStdEncoding.DecodeString(join.SigningKey)
		if e != nil || len(sign) != ed25519.PublicKeySize {
			return errors.New("invalid signing key")
		}
		engine, e := agent.NewDockerEngine(ctx, bk, caddy, join.CacheBytes)
		if e != nil {
			return e
		}
		defer engine.Close()
		pipeline, e := agent.NewPipeline(engine, &agent.StateStore{Path: filepath.Join(data, "state.bin"), Vault: vault}, filepath.Join(data, "builds"), int(join.BuildLimit))
		if e != nil {
			return e
		}
		pipeline.Stats = host.Metrics
		g, gctx := errgroup.WithContext(ctx)
		rpc := &transport.AgentClient{URL: join.ControlURL, ServerID: join.ServerID, TLS: tls, Verifier: &security.Verifier{Key: ed25519.PublicKey(sign), ServerID: join.ServerID, Path: filepath.Join(data, "replay.json")}, Handler: pipeline, Metrics: host.Metrics, Active: pipeline.Active, Observed: pipeline.Observed}
		g.Go(func() error { return pipeline.Run(gctx) })
		g.Go(func() error { return rpc.Run(gctx) })
		g.Go(func() error { return host.Diagnostics(gctx, diag, wg) })
		return g.Wait()
	}})
	return root
}
func enroll(ctx context.Context, dir, panel, tokenFile, pubFile string) error {
	u, e := url.Parse(panel)
	if e != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("HTTPS panel URL required")
	}
	token, e := os.ReadFile(tokenFile)
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
