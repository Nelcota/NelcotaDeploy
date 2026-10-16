package transport

import (
	"context"
	"crypto/tls"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/updater"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestCertificateRenewalThroughRealMutualTLS(t *testing.T) {
	ca, e := security.NewAuthority(time.Now().Add(-100 * 24 * time.Hour))
	if e != nil {
		t.Fatal(e)
	}
	root, _, _ := ca.PEM()
	cert, key, _ := ca.Issue("127.0.0.1", true, time.Now())
	serverTLS, _ := security.TLSConfig(cert, key, root, true)
	cert, key, _ = ca.Issue("agent-1", false, time.Now().Add(-70*24*time.Hour))
	config, _ := security.TLSConfig(cert, key, root, false)
	manager, e := security.NewCertificates(filepath.Join(t.TempDir(), "pair.json"), "agent-1", false, root, security.CertificateBundle{Certificate: string(cert), PrivateKey: string(key)})
	if e != nil {
		t.Fatal(e)
	}
	config.Certificates = nil
	config.GetClientCertificate = manager.GetClientCertificate
	newCert, newKey, _ := ca.Issue("agent-1", false, time.Now())
	calls := 0
	mux := http.NewServeMux()
	mux.Handle(CertificatePath, CertificateHandler(func(ctx context.Context, p Peer) (security.CertificateBundle, error) {
		calls++
		if p.ID != "agent-1" || p.Fingerprint == "" {
			t.Error("lost TLS identity", p)
		}
		return security.CertificateBundle{Certificate: string(newCert), PrivateKey: string(newKey)}, nil
	}))
	prepareCalls := 0
	mux.Handle(AgentUpdatePath, AgentUpdateHandler(func(_ context.Context, p Peer, r updater.Request) error {
		prepareCalls++
		if p.ID != "agent-1" || r.ID != "update-1" {
			t.Error("maintenance identity mismatch")
		}
		return nil
	}))
	server := httptest.NewUnstartedServer(mux)
	server.TLS = serverTLS
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	if e = RenewCertificate(t.Context(), server.URL, config, manager); e != nil || manager.Due(time.Now()) || calls != 1 {
		t.Fatal(e, calls)
	}
	if e = PrepareAgentUpdate(t.Context(), server.URL, config, updater.Request{ID: "update-1", Version: "v1.0.0"}); e != nil || prepareCalls != 1 {
		t.Fatal(e, prepareCalls)
	}
	// Anonymous clients never reach the service's renewal function.
	anonymous := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, Timeout: time.Second}
	_, _ = anonymous.Post(server.URL+CertificatePath, "application/json", nil)
	if calls != 1 {
		t.Fatal("anonymous certificate renewal")
	}
}
