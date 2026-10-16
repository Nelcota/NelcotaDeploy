//go:build integration

// Package testinfra forwards the runner's supported network configuration to
// integration containers. Docker's CLI does this automatically; its Go SDK does not.
package testinfra

import (
	"context"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/testcontainers/testcontainers-go"
)

// Proxy names can be provided only through the runner's /etc/hosts. Containers
// must inherit those mappings too; using the upstream resolver alone fails in
// environments where all egress is mediated by a sidecar.
func Hosts() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	hosts := []string{}
	seen := map[string]bool{}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		u, err := url.Parse(os.Getenv(key))
		if err != nil || u.Hostname() == "" || seen[u.Hostname()] {
			continue
		}
		name := u.Hostname()
		seen[name] = true
		ips, err := net.DefaultResolver.LookupHost(ctx, name)
		if err != nil {
			continue
		}
		for _, ip := range ips {
			if net.ParseIP(ip).To4() != nil {
				hosts = append(hosts, name+":"+ip)
				break
			}
		}
	}
	return hosts
}

func Environment() map[string]string {
	env := map[string]string{}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"} {
		if value, ok := os.LookupEnv(key); ok {
			env[key] = value
		}
	}
	if certificate() != "" {
		env["SSL_CERT_FILE"] = "/etc/nelcota-test/ca.pem"
	}
	return env
}

func Files() []testcontainers.ContainerFile {
	if path := certificate(); path != "" {
		return []testcontainers.ContainerFile{{HostFilePath: path, ContainerFilePath: "/etc/nelcota-test/ca.pem", FileMode: 0644}}
	}
	return nil
}

func certificate() string {
	path := os.Getenv("SSL_CERT_FILE")
	if path != "" {
		if stat, err := os.Stat(path); err == nil && stat.Mode().IsRegular() {
			return path
		}
	}
	return ""
}
