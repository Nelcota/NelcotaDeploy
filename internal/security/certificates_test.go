package security

import (
	"context"
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCertificateRotationPersistsAndPreservesIdentity(t *testing.T) {
	now := time.Now()
	ca, e := NewAuthority(now.Add(-100 * 24 * time.Hour))
	if e != nil {
		t.Fatal(e)
	}
	root, _, _ := ca.PEM()
	cert, key, _ := ca.Issue("server", false, now.Add(-70*24*time.Hour))
	path := filepath.Join(t.TempDir(), "certificate.json")
	m, e := NewCertificates(path, "server", false, root, CertificateBundle{string(cert), string(key)})
	if e != nil || !m.Due(now) {
		t.Fatal(e)
	}
	cert, key, _ = ca.Issue("other", false, now)
	if e = m.Update(CertificateBundle{string(cert), string(key)}); e == nil {
		t.Fatal("accepted another identity")
	}
	cert, key, _ = ca.Issue("server", false, now)
	if e = m.Update(CertificateBundle{string(cert), string(key)}); e != nil || m.Due(now) {
		t.Fatal(e)
	}
	restored, e := NewCertificates(path, "server", false, root, CertificateBundle{})
	if e != nil {
		t.Fatal(e)
	}
	pair, _ := restored.GetClientCertificate(&tls.CertificateRequestInfo{})
	if pair.Leaf.Subject.CommonName != "server" {
		t.Fatal(pair.Leaf.Subject)
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != 0600 {
		t.Fatal(st.Mode())
	}
	serverCert, serverKey, _ := ca.Issue("127.0.0.1", true, now.Add(-100*24*time.Hour))
	local, e := NewCertificates(filepath.Join(t.TempDir(), "control.json"), "127.0.0.1", true, root, CertificateBundle{string(serverCert), string(serverKey)})
	if e != nil {
		t.Fatal("could not recover expired local server certificate", e)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if e = local.RunLocal(ctx, ca); e != nil || local.Due(now) {
		t.Fatal(e)
	}
}
