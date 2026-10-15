package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/nelcota/nelcota-deploy/internal/events"
	"github.com/nelcota/nelcota-deploy/internal/host"
	"github.com/nelcota/nelcota-deploy/internal/httpapi"
	"github.com/nelcota/nelcota-deploy/internal/maintenance"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/service"
	"github.com/nelcota/nelcota-deploy/internal/store"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"github.com/nelcota/nelcota-deploy/internal/updater"
	"github.com/nelcota/nelcota-deploy/scripts"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
)

type config struct{ data, keys, listen, origin, control, wg, endpoint, wgPublic, diagnostics string }

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if e := command().ExecuteContext(ctx); e != nil {
		if !errors.Is(e, context.Canceled) {
			slog.Error("comando não concluído", "reason", safeError(e))
			os.Exit(1)
		}
	}
}
func safeError(e error) string {
	var typed *service.Error
	if errors.As(e, &typed) {
		return typed.Message
	}
	return "verifique configuração, permissões e disponibilidade dos serviços"
}
func command() *cobra.Command {
	cfg := config{}
	root := &cobra.Command{Use: "nelcota-panel", SilenceUsage: true, SilenceErrors: true}
	f := root.PersistentFlags()
	f.StringVar(&cfg.data, "data-dir", env("NELCOTA_DATA_DIR", "/var/lib/nelcota"), "Diretório de dados")
	f.StringVar(&cfg.keys, "config-dir", env("NELCOTA_CONFIG_DIR", "/etc/nelcota"), "Diretório de chaves")
	f.StringVar(&cfg.listen, "listen", env("NELCOTA_LISTEN", "127.0.0.1:8080"), "API HTTP atrás do Caddy")
	f.StringVar(&cfg.origin, "origin", env("NELCOTA_ORIGIN", "https://localhost"), "Origem exata do painel")
	f.StringVar(&cfg.control, "control-listen", env("NELCOTA_CONTROL_LISTEN", "10.77.0.1:8443"), "Endereço WireGuard do controle")
	f.StringVar(&cfg.wg, "wg-interface", env("NELCOTA_WG_INTERFACE", "wg0"), "Interface WireGuard")
	f.StringVar(&cfg.endpoint, "wg-endpoint", env("NELCOTA_WG_ENDPOINT", ""), "Endpoint público do WireGuard")
	f.StringVar(&cfg.wgPublic, "wg-public-key", env("NELCOTA_WG_PUBLIC_KEY", ""), "Chave pública WireGuard do painel")
	f.StringVar(&cfg.diagnostics, "pprof-listen", env("NELCOTA_PPROF_LISTEN", ""), "Diagnósticos apenas no WireGuard")
	init := &cobra.Command{Use: "init", RunE: func(cmd *cobra.Command, _ []string) error {
		email, _ := cmd.Flags().GetString("email")
		name, _ := cmd.Flags().GetString("name")
		if e := initialize(cmd.Context(), cfg); e != nil {
			return e
		}
		c, a, e := open(cmd.Context(), cfg)
		if e != nil {
			return e
		}
		defer c.DB.Close()
		en, e := a.Bootstrap(cmd.Context(), service.UserInput{Email: email, Name: name})
		if e != nil {
			return e
		}
		return json.NewEncoder(cmd.OutOrStdout()).Encode(en)
	}}
	init.Flags().String("email", "", "E-mail do administrador")
	init.Flags().String("name", "Administrador", "Nome do administrador")
	_ = init.MarkFlagRequired("email")
	root.AddCommand(init)
	root.AddCommand(&cobra.Command{Use: "serve", RunE: func(cmd *cobra.Command, _ []string) error { return serve(cmd.Context(), cfg, false) }})
	root.AddCommand(&cobra.Command{Use: "dev", RunE: func(cmd *cobra.Command, _ []string) error {
		cfg = devConfig(cfg)
		if e := initialize(cmd.Context(), cfg); e != nil {
			return e
		}
		return serve(cmd.Context(), cfg, true)
	}})
	root.AddCommand(&cobra.Command{Use: "dev-seed", RunE: func(cmd *cobra.Command, _ []string) error {
		cfg = devConfig(cfg)
		if e := initialize(cmd.Context(), cfg); e != nil {
			return e
		}
		c, _, e := open(cmd.Context(), cfg)
		if e != nil {
			return e
		}
		defer c.DB.Close()
		return c.Seed(cmd.Context())
	}})
	root.AddCommand(maintenanceCommands(&cfg)...)
	root.AddCommand(updater.Commands("panel", &cfg.data)...)
	return root
}
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func devConfig(c config) config {
	c.data = env("NELCOTA_DEV_DATA_DIR", ".local/dev")
	c.keys = filepath.Join(c.data, "keys")
	c.origin = "http://127.0.0.1:8080"
	c.listen = "127.0.0.1:8080"
	return c
}
func initialize(ctx context.Context, c config) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if e := os.MkdirAll(c.data, 0700); e != nil {
		return e
	}
	if e := os.MkdirAll(c.keys, 0700); e != nil {
		return e
	}
	for _, name := range []string{"backup.key"} {
		path := filepath.Join(c.keys, name)
		if _, e := os.Stat(path); errors.Is(e, os.ErrNotExist) {
			key := make([]byte, 32)
			if _, e = rand.Read(key); e != nil {
				return e
			}
			if e = host.WriteExclusive(path, key); e != nil {
				return e
			}
		}
	}
	keyPath := filepath.Join(c.keys, "master.key")
	if _, e := os.Stat(keyPath); errors.Is(e, os.ErrNotExist) {
		key := make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			return e
		}
		if e = host.WriteExclusive(keyPath, key); e != nil {
			return e
		}
	}
	caPath := filepath.Join(c.keys, "ca.pem")
	if _, e := os.Stat(caPath); errors.Is(e, os.ErrNotExist) {
		ca, e := security.NewAuthority(time.Now())
		if e != nil {
			return e
		}
		cert, key, e := ca.PEM()
		if e != nil {
			return e
		}
		if e = host.WriteExclusive(caPath, cert); e != nil {
			return e
		}
		if e = host.WriteExclusive(filepath.Join(c.keys, "ca.key"), key); e != nil {
			return e
		}
		name, _, e := net.SplitHostPort(c.control)
		if e != nil {
			return e
		}
		cert, key, e = ca.Issue(name, true, time.Now())
		if e != nil {
			return e
		}
		if e = host.WriteExclusive(filepath.Join(c.keys, "control.pem"), cert); e != nil {
			return e
		}
		if e = host.WriteExclusive(filepath.Join(c.keys, "control.key"), key); e != nil {
			return e
		}
	}
	path := filepath.Join(c.keys, "signing.key")
	if _, e := os.Stat(path); errors.Is(e, os.ErrNotExist) {
		_, key, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			return e
		}
		if e = host.WriteExclusive(path, key); e != nil {
			return e
		}
	}
	return nil
}
func open(ctx context.Context, c config) (*service.Core, *service.AuthService, error) {
	key, e := security.LoadKey(filepath.Join(c.keys, "master.key"))
	if e != nil {
		return nil, nil, e
	}
	v, e := security.NewVault(key)
	if e != nil {
		return nil, nil, e
	}
	db, e := store.Open(ctx, filepath.Join(c.data, "panel.db"))
	if e != nil {
		return nil, nil, e
	}
	logs, e := events.NewLogStore(filepath.Join(c.data, "logs"))
	if e != nil {
		_ = db.Close()
		return nil, nil, e
	}
	core := &service.Core{DB: db, Vault: v, Hub: events.NewHub(), LogStore: logs}
	backup := maintenance.Backup{Data: c.data, Config: c.keys, KeyFile: env("NELCOTA_BACKUP_KEY_FILE", filepath.Join(c.keys, "backup.key"))}
	ops := &service.OperationsService{Core: core, Version: updater.Version, PanelResult: func() updater.Result { return updater.ReadResult(c.data) }}
	ops.CreateBackup = func(ctx context.Context, id string) error {
		output := filepath.Join(c.data, "backups", "manual-"+id+".nbk")
		if _, e := os.Stat(output); errors.Is(e, os.ErrNotExist) {
			if e = backup.Create(ctx, output); e != nil {
				return e
			}
		}
		return uploadBackup(ctx, core, output)
	}
	if trust, e := updater.LoadTrust(updater.TrustPath("panel")); e == nil {
		ops.VerifyRelease = trust.Check
		ops.QueuePanel = func(id, version string) error {
			return updater.Queue(c.data, updater.Request{ID: id, Version: version})
		}
	}
	core.Operations = ops
	u, e := url.Parse(c.origin)
	if e != nil || u.Hostname() == "" {
		_ = db.Close()
		return nil, nil, errors.New("invalid origin")
	}
	auth, e := service.NewAuth(core, u.Hostname(), c.origin)
	if e != nil {
		_ = db.Close()
	}
	return core, auth, e
}
func serve(ctx context.Context, c config, dev bool) error {
	u, e := url.Parse(c.origin)
	if e != nil {
		return e
	}
	if !dev && u.Scheme != "https" {
		return errors.New("production requires HTTPS origin")
	}
	bind, _, e := net.SplitHostPort(c.listen)
	if e != nil || net.ParseIP(bind) == nil || !net.ParseIP(bind).IsLoopback() {
		return errors.New("public API must bind loopback behind Caddy")
	}
	core, auth, e := open(ctx, c)
	if e != nil {
		return e
	}
	defer core.DB.Close()
	key, e := security.LoadKey(filepath.Join(c.keys, "master.key"))
	if e != nil {
		return e
	}
	api := httpapi.Config{Origin: c.origin, Dev: dev, CSRFKey: key, Services: core.Services(auth), AgentScript: scripts.Agent}
	g, gctx := errgroup.WithContext(ctx)
	if dev {
		if e = core.Seed(ctx); e != nil {
			return e
		}
		dispatcher := service.NewDevDispatcher(core, gctx)
		core.Control = dispatcher
		api.DevelopmentLogin = auth.DevelopmentSession
		g.Go(func() error { return dispatcher.Run(gctx) })
		slog.Warn("modo de desenvolvimento: login simulado em POST /api/dev/session; escuta apenas 127.0.0.1")
	} else {
		if e = host.RequireInterface(c.control, c.wg); e != nil {
			return e
		}
		cert, e := host.Read(filepath.Join(c.keys, "control.pem"))
		if e != nil {
			return e
		}
		tlsKey, e := host.ReadSecret(filepath.Join(c.keys, "control.key"))
		if e != nil {
			return e
		}
		caPEM, e := host.Read(filepath.Join(c.keys, "ca.pem"))
		if e != nil {
			return e
		}
		caKey, e := host.ReadSecret(filepath.Join(c.keys, "ca.key"))
		if e != nil {
			return e
		}
		tlsConfig, e := security.TLSConfig(cert, tlsKey, caPEM, true)
		if e != nil {
			return e
		}
		sign, e := host.ReadSecret(filepath.Join(c.keys, "signing.key"))
		if e != nil || len(sign) != ed25519.PrivateKeySize {
			return errors.New("invalid signing key")
		}
		broker := transport.NewBroker(ed25519.PrivateKey(sign))
		broker.Sink = core
		core.Control = broker
		authority, e := security.ParseAuthority(caPEM, caKey)
		if e != nil {
			return e
		}
		panelIP, _, _ := net.SplitHostPort(c.control)
		certificates, e := security.NewCertificates(filepath.Join(c.data, "control-certificate.json"), panelIP, true, caPEM, security.CertificateBundle{Certificate: string(cert), PrivateKey: string(tlsKey)})
		if e != nil {
			return e
		}
		// Renew an expired server certificate before accepting connections as well.
		if certificates.Due(time.Now()) {
			cert, key, e := authority.Issue(panelIP, true, time.Now())
			if e != nil {
				return e
			}
			if e = certificates.Update(security.CertificateBundle{Certificate: string(cert), PrivateKey: string(key)}); e != nil {
				return e
			}
		}
		tlsConfig.Certificates = nil
		tlsConfig.GetCertificate = certificates.GetCertificate
		api.Enrollment = &service.EnrollmentService{Core: core, CA: authority, Peers: service.WireGuard{Device: c.wg}, PanelAddress: panelIP, PanelEndpoint: c.endpoint, PanelWireGuardKey: c.wgPublic, SigningKey: base64.RawStdEncoding.EncodeToString(ed25519.PrivateKey(sign).Public().(ed25519.PublicKey)), ControlURL: "https://" + c.control}
		path, handler := broker.Handler()
		mux := http.NewServeMux()
		mux.Handle(path, handler)
		mux.Handle(transport.CertificatePath, transport.CertificateHandler(api.Enrollment.Renew))
		mux.Handle(transport.AgentUpdatePath, transport.AgentUpdateHandler(core.PrepareAgentUpdate))
		peersCtx, peersCancel := context.WithTimeout(gctx, 10*time.Second)
		e = api.Enrollment.SyncPeers(peersCtx)
		peersCancel()
		if e != nil {
			return e
		}
		control := host.Server(c.control, mux)
		control.TLSConfig = tlsConfig
		g.Go(func() error { return host.Serve(gctx, control, true) })
		g.Go(func() error { return certificates.RunLocal(gctx, authority) })

		gh := &service.GitHubService{Core: core}
		core.GitHub = gh
		api.GitHub = gh
	}
	g.Go(func() error { return host.Diagnostics(gctx, c.diagnostics, c.wg) })
	if !dev {
		b := maintenance.Backup{Data: c.data, Config: c.keys, KeyFile: env("NELCOTA_BACKUP_KEY_FILE", filepath.Join(c.keys, "backup.key"))}
		g.Go(func() error {
			return b.Run(gctx, func(ctx context.Context, p string) error { return uploadBackup(ctx, core, p) }, func(error) { slog.Error("backup não concluído; nova tentativa em uma hora") })
		})
	}
	g.Go(func() error { return core.RunScheduler(gctx) })
	g.Go(func() error { return core.RunChecks(gctx) })
	g.Go(func() error { return core.Operations.Run(gctx) })
	g.Go(func() error {
		return updater.RunRequests(gctx, c.data, func(ctx context.Context, r updater.Request) (bool, error) {
			ctx = service.WithPrincipal(ctx, service.Principal{ID: "system", Role: "admin", TwoFactorAt: time.Now().Unix()})
			_, e := core.Operations.Update(ctx, r.Version)
			return e == nil, e
		}, func(error) { slog.Warn("solicitação local de atualização não concluída") })
	})
	g.Go(func() error {
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-gctx.Done():
				return nil
			case <-tick.C:
				if e := auth.Cleanup(gctx); e != nil {
					return e
				}
			}
		}
	})
	public := host.Server(c.listen, httpapi.New(api))
	public.ReadTimeout = 15 * time.Second
	g.Go(func() error { return host.Serve(gctx, public, false) })
	fmt.Printf("Nelcota Deploy: %s\n", c.origin)
	return g.Wait()
}

func uploadBackup(ctx context.Context, core *service.Core, path string) error {
	if p := env("NELCOTA_BACKUP_S3_CONFIG", ""); p != "" {
		cfg, e := maintenance.LoadS3(p)
		if e != nil {
			return e
		}
		return cfg.Upload(ctx, path)
	}
	value, e := core.Setting(ctx, "backup.s3")
	if errors.Is(e, sql.ErrNoRows) || (e == nil && value == "") {
		return nil
	}
	if e != nil {
		return e
	}
	var cfg maintenance.S3
	if json.Unmarshal([]byte(value), &cfg) != nil {
		return errors.New("invalid S3 configuration")
	}
	return cfg.Upload(ctx, path)
}
