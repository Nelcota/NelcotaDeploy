package security

import (
	"context"
	"crypto/tls"
	"os"
	"path/filepath"
	"sync"
	"syscall"
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

func TestPersistedCertificatesRejectUnsafeFiles(t *testing.T) {
	ca, _ := NewAuthority(time.Now())
	root, _, _ := ca.PEM()
	cert, key, _ := ca.Issue("server", false, time.Now())
	initial := CertificateBundle{string(cert), string(key)}
	for _, kind := range []string{"symlink", "fifo", "public", "oversized"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "certificate.json")
			switch kind {
			case "symlink":
				other := filepath.Join(dir, "other")
				_ = os.WriteFile(other, []byte(`{}`), 0600)
				_ = os.Symlink(other, path)
			case "fifo":
				_ = syscall.Mkfifo(path, 0600)
			case "public":
				m, e := NewCertificates(path, "server", false, root, initial)
				if e != nil {
					t.Fatal(e)
				}
				if e = m.Update(initial); e != nil {
					t.Fatal(e)
				}
				_ = os.Chmod(path, 0644)
			case "oversized":
				_ = os.WriteFile(path, nil, 0600)
				_ = os.Truncate(path, (32<<10)+1)
			}
			if _, e := NewCertificates(path, "server", false, root, initial); e == nil {
				t.Fatal("accepted unsafe persisted certificate", kind)
			}
		})
	}
}

func TestConcurrentCertificateUpdatesPersistActivePair(t *testing.T) {
	ca, _ := NewAuthority(time.Now())
	root, _, _ := ca.PEM()
	cert, key, _ := ca.Issue("server", false, time.Now())
	path := filepath.Join(t.TempDir(), "certificate.json")
	m, e := NewCertificates(path, "server", false, root, CertificateBundle{string(cert), string(key)})
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for range 16 {
		cert, key, e := ca.Issue("server", false, time.Now())
		if e != nil {
			t.Fatal(e)
		}
		wg.Go(func() {
			if e := m.Update(CertificateBundle{string(cert), string(key)}); e != nil {
				t.Error(e)
			}
		})
	}
	wg.Wait()
	reloaded, e := NewCertificates(path, "server", false, root, CertificateBundle{})
	if e != nil {
		t.Fatal(e)
	}
	active, _ := m.GetClientCertificate(nil)
	persisted, _ := reloaded.GetClientCertificate(nil)
	if !active.Leaf.Equal(persisted.Leaf) {
		t.Fatal("memory and disk disagree about the active certificate")
	}
}
