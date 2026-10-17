package main

import (
	"context"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
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

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/httpapi"
	"github.com/Nelcota/NelcotaDeploy/internal/maintenance"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/internal/store"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
	"github.com/Nelcota/NelcotaDeploy/internal/updater"
	"github.com/Nelcota/NelcotaDeploy/scripts"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
)

type config struct{ data, keys, listen, origin, control, wg, endpoint, wgPublic, diagnostics string }

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if e := command().ExecuteContext(ctx); e != nil {
		if !errors.Is(e, context.Canceled) {
			slog.Error("command failed", failure(e)...)
			os.Exit(1)
		}
	}
}

// failure describes a failed command: a service error's message, or a generic
// hint plus the underlying cause for the operator's log.
func failure(e error) []any {
	var typed *service.Error
	if errors.As(e, &typed) {
		return []any{"reason", typed.Message}
	}
	return []any{"reason", "check configuration, permissions, and service availability", "err", e}
}
func command() *cobra.Command {
	cfg := config{}
	root := &cobra.Command{Use: "nelcota-panel", SilenceUsage: true, SilenceErrors: true}
	f := root.PersistentFlags()
	f.StringVar(&cfg.data, "data-dir", env("NELCOTA_DATA_DIR", "/var/lib/nelcota"), "Data directory")
	f.StringVar(&cfg.keys, "config-dir", env("NELCOTA_CONFIG_DIR", "/etc/nelcota"), "Key directory")
	f.StringVar(&cfg.listen, "listen", env("NELCOTA_LISTEN", "127.0.0.1:8080"), "HTTP API behind Caddy")
	f.StringVar(&cfg.origin, "origin", env("NELCOTA_ORIGIN", "https://localhost"), "Exact panel origin")
	f.StringVar(&cfg.control, "control-listen", env("NELCOTA_CONTROL_LISTEN", "10.77.0.1:8443"), "Control WireGuard address")
	f.StringVar(&cfg.wg, "wg-interface", env("NELCOTA_WG_INTERFACE", "wg0"), "WireGuard interface")
	f.StringVar(&cfg.endpoint, "wg-endpoint", env("NELCOTA_WG_ENDPOINT", ""), "Public WireGuard endpoint")
	f.StringVar(&cfg.wgPublic, "wg-public-key", env("NELCOTA_WG_PUBLIC_KEY", ""), "Panel WireGuard public key")
	f.StringVar(&cfg.diagnostics, "pprof-listen", env("NELCOTA_PPROF_LISTEN", ""), "Diagnostics on WireGuard only")
	init := &cobra.Command{Use: "init", RunE: func(cmd *cobra.Command, _ []string) error {
		email, _ := cmd.Flags().GetString("email")
		name, _ := cmd.Flags().GetString("name")
		if e := initialize(cmd.Context(), cfg); e != nil {
			return e
		}
		p, e := open(cmd.Context(), cfg)
		if e != nil {
			return e
		}
		defer p.core.DB.Close()
		en, e := p.auth.Bootstrap(cmd.Context(), service.UserInput{Email: email, Name: name})
		if e != nil {
			return e
		}
		return json.NewEncoder(cmd.OutOrStdout()).Encode(en)
	}}
	init.Flags().String("email", "", "Administrator email")
	init.Flags().String("name", "Administrator", "Administrator name")
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
		p, e := open(cmd.Context(), cfg)
		if e != nil {
			return e
		}
		defer p.core.DB.Close()
		return p.core.Seed(cmd.Context())
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
	// Browsers reject IP addresses as WebAuthn RP IDs; set
	// NELCOTA_DEV_ORIGIN=http://localhost:8080 to exercise real passkeys.
	c.origin = env("NELCOTA_DEV_ORIGIN", "http://127.0.0.1:8080")
	c.listen = env("NELCOTA_DEV_LISTEN", "127.0.0.1:8080")
	return c
}

// backupKeyFile is the backup key used by serve, backup, and restore alike.
func backupKeyFile(keys string) string {
	return env("NELCOTA_BACKUP_KEY_FILE", filepath.Join(keys, "backup.key"))
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
	randomKey := func() ([]byte, error) {
		key := make([]byte, 32)
		_, e := rand.Read(key)
		return key, e
	}
	signingKey := func() ([]byte, error) {
		_, key, e := ed25519.GenerateKey(rand.Reader)
		return key, e
	}
	// The default backup key is created even when NELCOTA_BACKUP_KEY_FILE points
	// elsewhere: an operator-managed key must never be replaced by a new one.
	for name, generate := range map[string]func() ([]byte, error){"backup.key": randomKey, "master.key": randomKey, "signing.key": signingKey} {
		if e := ensure(filepath.Join(c.keys, name), generate); e != nil {
			return e
		}
	}
	if missing, e := absent(filepath.Join(c.keys, "ca.pem")); e != nil || !missing {
		return e
	}
	return createAuthority(c)
}

// absent reports whether path does not exist; other stat failures are errors.
func absent(path string) (bool, error) {
	_, e := os.Stat(path)
	if errors.Is(e, os.ErrNotExist) {
		return true, nil
	}
	return false, e
}

// ensure writes a newly generated secret to path unless it already exists.
func ensure(path string, generate func() ([]byte, error)) error {
	if missing, e := absent(path); e != nil || !missing {
		return e
	}
	b, e := generate()
	if e != nil {
		return e
	}
	return host.WriteExclusive(path, b)
}

// createAuthority writes the control CA and the panel's control certificate.
func createAuthority(c config) error {
	name, _, e := net.SplitHostPort(c.control)
	if e != nil {
		return e
	}
	ca, e := security.NewAuthority(time.Now())
	if e != nil {
		return e
	}
	caCert, caKey, e := ca.PEM()
	if e != nil {
		return e
	}
	cert, key, e := ca.Issue(name, true, time.Now())
	if e != nil {
		return e
	}
	for _, f := range []struct {
		name string
		data []byte
	}{{"ca.pem", caCert}, {"ca.key", caKey}, {"control.pem", cert}, {"control.key", key}} {
		if e = host.WriteExclusive(filepath.Join(c.keys, f.name), f.data); e != nil {
			return e
		}
	}
	return nil
}

// panel holds what every command needs from the data and key directories.
type panel struct {
	core   *service.Core
	auth   *service.AuthService
	origin *url.URL
	backup maintenance.Backup
	upload func(context.Context, string) error
	// csrf is derived from the master key so the vault key itself never signs
	// browser-visible tokens.
	csrf []byte
}

func open(ctx context.Context, c config) (*panel, error) {
	u, e := url.Parse(c.origin)
	if e != nil || u.Hostname() == "" {
		return nil, errors.New("invalid origin")
	}
	key, e := security.LoadKey(filepath.Join(c.keys, "master.key"))
	if e != nil {
		return nil, e
	}
	v, e := security.NewVault(key)
	if e != nil {
		return nil, e
	}
	csrf, e := hkdf.Key(sha256.New, key, nil, "nelcota csrf v1", 32)
	if e != nil {
		return nil, e
	}
	db, e := store.Open(ctx, filepath.Join(c.data, "panel.db"))
	if e != nil {
		return nil, e
	}
	logs, e := events.NewLogStore(filepath.Join(c.data, "logs"))
	if e != nil {
		_ = db.Close()
		return nil, e
	}
	core := &service.Core{DB: db, Vault: v, Hub: events.NewHub(), LogStore: logs}
	backup := maintenance.Backup{Data: c.data, Config: c.keys, KeyFile: backupKeyFile(c.keys)}
	s3File := env("NELCOTA_BACKUP_S3_CONFIG", "")
	upload := func(ctx context.Context, path string) error { return core.UploadBackup(ctx, path, s3File) }
	ops := &service.OperationsService{Core: core, Version: updater.Version, PanelResult: func() updater.Result { return updater.ReadResult(c.data) }}
	ops.CreateBackup = func(ctx context.Context, id string) error {
		output := filepath.Join(c.data, "backups", "manual-"+id+".nbk")
		missing, e := absent(output)
		if e != nil {
			return e
		}
		if missing {
			if e = backup.Create(ctx, output); e != nil {
				return e
			}
		}
		return upload(ctx, output)
	}
	if trust, e := updater.LoadTrust(updater.TrustPath("panel")); e == nil {
		ops.VerifyRelease = trust.Check
		ops.LatestRelease = trust.Latest
		ops.QueuePanel = func(id, version string) error {
			return updater.Queue(c.data, updater.Request{ID: id, Version: version})
		}
	}
	core.Operations = ops
	auth, e := service.NewAuth(core, u.Hostname(), c.origin)
	if e != nil {
		_ = db.Close()
		return nil, e
	}
	return &panel{core: core, auth: auth, origin: u, backup: backup, upload: upload, csrf: csrf}, nil
}
func serve(ctx context.Context, c config, dev bool) error {
	bind, _, e := net.SplitHostPort(c.listen)
	if e != nil || net.ParseIP(bind) == nil || !net.ParseIP(bind).IsLoopback() {
		return errors.New("public API must bind loopback behind Caddy")
	}
	p, e := open(ctx, c)
	if e != nil {
		return e
	}
	defer p.core.DB.Close()
	if !dev && p.origin.Scheme != "https" {
		return errors.New("production requires HTTPS origin")
	}
	core, auth := p.core, p.auth
	api := httpapi.Config{Origin: c.origin, Dev: dev, CSRFKey: p.csrf, Services: core.Services(auth), AgentScript: scripts.Agent, Version: updater.Version}
	g, gctx := errgroup.WithContext(ctx)
	if dev {
		if e = core.Seed(ctx); e != nil {
			return e
		}
		dispatcher := service.NewDevDispatcher(core, gctx)
		core.Control = dispatcher
		api.DevelopmentLogin = auth.DevelopmentSession
		api.Services.Repos = service.DevRepos{}
		g.Go(func() error { return dispatcher.Run(gctx) })
		slog.Warn("development mode: simulated login at POST /api/dev/session; listening on 127.0.0.1 only")
	} else {
		if e = host.RequireInterface(c.control, c.wg); e != nil {
			return e
		}
		cert, e := os.ReadFile(filepath.Join(c.keys, "control.pem"))
		if e != nil {
			return e
		}
		tlsKey, e := host.ReadSecret(filepath.Join(c.keys, "control.key"))
		if e != nil {
			return e
		}
		caPEM, e := os.ReadFile(filepath.Join(c.keys, "ca.pem"))
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
		api.Enrollment = &service.EnrollmentService{
			Core:              core,
			CA:                authority,
			Peers:             service.WireGuard{Device: c.wg},
			PanelAddress:      panelIP,
			PanelEndpoint:     c.endpoint,
			PanelWireGuardKey: c.wgPublic,
			SigningKey:        base64.RawStdEncoding.EncodeToString(ed25519.PrivateKey(sign).Public().(ed25519.PublicKey)),
			ControlURL:        "https://" + c.control,
		}
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
		api.Services.Repos = gh
	}
	g.Go(func() error { return host.Diagnostics(gctx, c.diagnostics, c.wg) })
	if !dev {
		g.Go(func() error {
			return p.backup.Run(gctx, p.upload, func(e error) {
				slog.Error("backup failed; retrying in one hour", "err", e)
				core.BackupFailed()
			})
		})
		g.Go(func() error {
			return p.backup.RunVerification(gctx, func(e error) {
				slog.Error("backup verification failed", "err", e)
				core.BackupUnverified()
			})
		})
	}
	g.Go(func() error { return core.RunScheduler(gctx) })
	g.Go(func() error { return core.RunChecks(gctx) })
	g.Go(func() error { return core.Operations.Run(gctx) })
	release := service.Release{}
	if trust, e := updater.LoadTrust(updater.TrustPath("panel")); e == nil {
		release = service.ReleaseFor(trust.BaseURL, updater.Version, trust.PublicKey)
	}
	api.Services.Provisioning = &service.Provisioner{Core: core, Origin: c.origin, Release: release}
	notifier := service.NewNotifier(core, c.origin)
	api.Services.Notifications = notifier.Service()
	g.Go(func() error { return notifier.Run(gctx) })
	g.Go(func() error {
		return updater.RunRequests(gctx, c.data, func(ctx context.Context, r updater.Request) (bool, error) {
			_, e := core.Operations.LocalUpdate(ctx, r.Version)
			return e == nil, e
		}, func(e error) { slog.Warn("local update request failed", "err", e) })
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
	fmt.Printf("NelcotaDeploy: %s\n", c.origin)
	return g.Wait()
}
