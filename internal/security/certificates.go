package security

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
)

type CertificateBundle struct {
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"private_key"`
}
type Certificates struct {
	path, id string
	server   bool
	roots    *x509.CertPool
	pair     atomic.Pointer[tls.Certificate]
	mu       sync.Mutex
}

func NewCertificates(path, id string, server bool, ca []byte, initial CertificateBundle) (*Certificates, error) {
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid certificate authority")
	}
	m := &Certificates{path: path, id: id, server: server, roots: roots}
	if b, e := host.ReadPrivate(path, 32<<10); e == nil {
		if json.Unmarshal(b, &initial) != nil {
			return nil, errors.New("invalid persisted certificate")
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	pair, e := m.parse(initial, false)
	if e != nil {
		return nil, e
	}
	m.pair.Store(pair)
	return m, nil
}
func (m *Certificates) parse(bundle CertificateBundle, fresh bool) (*tls.Certificate, error) {
	pair, e := tls.X509KeyPair([]byte(bundle.Certificate), []byte(bundle.PrivateKey))
	if e != nil || len(pair.Certificate) != 1 {
		return nil, errors.New("invalid certificate pair")
	}
	leaf, e := x509.ParseCertificate(pair.Certificate[0])
	if e != nil {
		return nil, e
	}
	usage := x509.ExtKeyUsageClientAuth
	dns := ""
	if m.server {
		usage = x509.ExtKeyUsageServerAuth
		dns = m.id
	} else {
		valid := false
		for _, u := range leaf.URIs {
			if u.Scheme == "spiffe" && u.Host == "nelcota" && u.Path == "/agents/"+m.id {
				valid = true
			}
		}
		if !valid {
			return nil, errors.New("certificate identity mismatch")
		}
	}
	now := time.Now()
	if !fresh && now.After(leaf.NotAfter) {
		now = leaf.NotAfter.Add(-time.Second)
	}
	if _, e = leaf.Verify(x509.VerifyOptions{Roots: m.roots, KeyUsages: []x509.ExtKeyUsage{usage}, DNSName: dns, CurrentTime: now}); e != nil {
		return nil, errors.New("certificate chain verification failed")
	}
	if fresh && time.Until(leaf.NotAfter) < 24*time.Hour {
		return nil, errors.New("renewed certificate expires too soon")
	}
	pair.Leaf = leaf
	return &pair, nil
}
func (m *Certificates) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	return m.pair.Load(), nil
}
func (m *Certificates) GetClientCertificate(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
	return m.pair.Load(), nil
}
func (m *Certificates) Due(now time.Time) bool {
	return m.pair.Load().Leaf.NotAfter.Before(now.Add(30 * 24 * time.Hour))
}
func (m *Certificates) Update(bundle CertificateBundle) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pair, e := m.parse(bundle, true)
	if e != nil {
		return e
	}
	b, e := json.Marshal(bundle)
	if e != nil {
		return e
	}
	if e = host.WriteFileAtomic(m.path, b, 0600); e != nil {
		return e
	}
	m.pair.Store(pair)
	return nil
}
func (m *Certificates) RunLocal(ctx context.Context, ca *Authority) error {
	tick := time.NewTicker(12 * time.Hour)
	defer tick.Stop()
	for {
		if m.Due(time.Now()) {
			cert, key, e := ca.Issue(m.id, true, time.Now())
			if e != nil {
				return e
			}
			if e = m.Update(CertificateBundle{string(cert), string(key)}); e != nil {
				return e
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}
