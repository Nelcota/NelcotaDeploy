package updater

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/spf13/cobra"
)

func Commands(component string, data *string) []*cobra.Command {
	version := &cobra.Command{Use: "version", Args: cobra.NoArgs, RunE: func(c *cobra.Command, _ []string) error {
		return json.NewEncoder(c.OutOrStdout()).Encode(map[string]string{"version": Version})
	}}
	update := &cobra.Command{Use: "update VERSION", Short: "Request a signed release through the local helper", Args: cobra.ExactArgs(1), RunE: func(c *cobra.Command, args []string) error {
		if _, e := LoadTrust(TrustPath(component)); e != nil {
			return e
		}
		if !Newer(args[0], Version) {
			return errors.New("release must be newer than current version")
		}
		return RequestUpgrade(*data, Request{Version: args[0], ID: security.Token()})
	}}
	apply := &cobra.Command{Use: "apply-update", Hidden: true, Args: cobra.NoArgs, RunE: func(c *cobra.Command, _ []string) error {
		if os.Geteuid() != 0 {
			return errors.New("update helper requires root")
		}
		st, e := os.Lstat(TrustPath(component))
		if e != nil {
			return e
		}
		owner, ok := st.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != 0 {
			return errors.New("release trust must be owned by root")
		}
		trust, e := LoadTrust(TrustPath(component))
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(c.Context(), 8*time.Minute)
		defer cancel()
		return trust.Apply(ctx, *data, "/var/lib/nelcota-updater/"+component, "/usr/local/bin/nelcota-"+component, component, func(ctx context.Context, expected string) error {
			return restartService(ctx, component, *data, expected, trust.HealthURL)
		})
	}}
	var purge bool
	uninstall := &cobra.Command{Use: "uninstall", Short: "Remove the service and binary, preserving data by default", Args: cobra.NoArgs, RunE: func(c *cobra.Command, _ []string) error {
		if os.Geteuid() != 0 {
			return errors.New("uninstall requires root")
		}
		return Uninstall(c.Context(), "/", component, purge, func(ctx context.Context, args ...string) error {
			return exec.CommandContext(ctx, "/usr/bin/systemctl", args...).Run()
		})
	}}
	uninstall.Flags().BoolVar(&purge, "purge", false, "Also remove Nelcota data and keys; keep a backup first")
	return []*cobra.Command{version, update, apply, uninstall}
}
func restartService(ctx context.Context, component, data, expected, healthURL string) error {
	if healthURL == "" {
		healthURL = "http://127.0.0.1:8080/healthz"
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	unit := "nelcota-" + component + ".service"
	b, e := exec.CommandContext(ctx, "/usr/local/bin/nelcota-"+component, "version").Output()
	if e != nil {
		return errors.New("installed executable version check failed")
	}
	var version struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(b, &version) != nil || version.Version != expected {
		return errors.New("installed executable does not match release version")
	}
	if e := exec.CommandContext(ctx, "/usr/bin/systemctl", "restart", unit).Run(); e != nil {
		return errors.New("service restart failed")
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	stable := 0
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for {
		select {
		case <-ctx.Done():
			return errors.New("updated service did not become ready")
		case <-tick.C:
			good := exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", unit).Run() == nil
			if good && component == "agent" {
				b, e := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "--property=MainPID", "--value", unit).Output()
				if e != nil {
					good = false
				} else {
					pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
					good = pid > 0 && healthyAgent(data, expected, pid)
				}
			}
			if good && component == "panel" {
				req, e := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
				if e != nil {
					return e
				}
				r, e := client.Do(req)
				good = e == nil && r.StatusCode == 200
				if r != nil {
					_ = r.Body.Close()
				}
			}
			if good {
				stable++
			} else {
				stable = 0
			}
			if stable >= 5 {
				return nil
			}
		}
	}
}

// Uninstall removes only Nelcota-owned files. Docker, Caddy, WireGuard, firewall,
// SSH hardening and application containers remain available for explicit migration.
func Uninstall(ctx context.Context, root, component string, purge bool, systemctl func(context.Context, ...string) error) error {
	if component != "panel" && component != "agent" {
		return errors.New("invalid component")
	}
	units := []string{"nelcota-" + component + "-update.path", "nelcota-" + component + "-update.service", "nelcota-" + component + ".service"}
	installed := []string{}
	enabled := []string{}
	for _, unit := range units {
		if _, e := os.Stat(filepath.Join(root, "etc/systemd/system", unit)); e == nil {
			installed = append(installed, unit)
			if unit != units[1] {
				enabled = append(enabled, unit)
			}
		}
	}
	if len(installed) > 0 {
		if e := systemctl(ctx, append([]string{"stop"}, installed...)...); e != nil {
			return errors.New("could not stop Nelcota services")
		}
	}
	if len(enabled) > 0 {
		if e := systemctl(ctx, append([]string{"disable"}, enabled...)...); e != nil {
			return e
		}
	}
	for _, unit := range units {
		if e := os.Remove(filepath.Join(root, "etc/systemd/system", unit)); e != nil && !os.IsNotExist(e) {
			return e
		}
	}
	for _, suffix := range []string{"", ".previous"} {
		if e := os.Remove(filepath.Join(root, "usr/local/bin/nelcota-"+component+suffix)); e != nil && !os.IsNotExist(e) {
			return e
		}
	}
	if purge {
		config, data := "nelcota", "nelcota"
		if component == "agent" {
			config, data = "nelcota-agent", "nelcota-agent"
		}
		for _, p := range []string{"etc/" + config, "var/lib/" + data, "var/lib/nelcota-updater/" + component, "etc/nelcota-release-" + component + ".json"} {
			if e := os.RemoveAll(filepath.Join(root, p)); e != nil {
				return e
			}
		}
	}
	return systemctl(ctx, "daemon-reload")
}
