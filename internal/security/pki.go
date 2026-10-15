package security

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/url"
	"time"
)

type Authority struct {
	Cert *x509.Certificate
	Key  *ecdsa.PrivateKey
}

func serial() *big.Int {
	n, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		panic(err)
	}
	return n
}
func NewAuthority(now time.Time) (*Authority, error) {
	k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, e
	}
	t := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "Nelcota internal CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(5, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	b, e := x509.CreateCertificate(rand.Reader, t, t, &k.PublicKey, k)
	if e != nil {
		return nil, e
	}
	c, e := x509.ParseCertificate(b)
	return &Authority{c, k}, e
}
func ParseAuthority(certPEM, keyPEM []byte) (*Authority, error) {
	c, _ := pem.Decode(certPEM)
	k, _ := pem.Decode(keyPEM)
	if c == nil || k == nil {
		return nil, errors.New("invalid CA PEM")
	}
	cert, e := x509.ParseCertificate(c.Bytes)
	if e != nil {
		return nil, e
	}
	key, e := x509.ParseECPrivateKey(k.Bytes)
	return &Authority{cert, key}, e
}
func (a *Authority) PEM() ([]byte, []byte, error) {
	k, e := x509.MarshalECPrivateKey(a.Key)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: a.Cert.Raw}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: k}), e
}
func (a *Authority) Issue(id string, server bool, now time.Time) ([]byte, []byte, error) {
	k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, nil, e
	}
	t := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: id}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(0, 3, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	if server {
		t.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		if ip := net.ParseIP(id); ip != nil {
			t.IPAddresses = []net.IP{ip}
		} else {
			t.DNSNames = []string{id}
		}
	} else {
		t.URIs = []*url.URL{{Scheme: "spiffe", Host: "nelcota", Path: "/agents/" + id}}
	}
	b, e := x509.CreateCertificate(rand.Reader, t, a.Cert, &k.PublicKey, a.Key)
	if e != nil {
		return nil, nil, e
	}
	kb, e := x509.MarshalECPrivateKey(k)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: b}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), e
}
func TLSConfig(cert, key, ca []byte, server bool) (*tls.Config, error) {
	pair, e := tls.X509KeyPair(cert, key)
	if e != nil {
		return nil, e
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid CA")
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, NextProtos: []string{"h2"}}
	if server {
		cfg.ClientCAs = pool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	} else {
		cfg.RootCAs = pool
	}
	return cfg, nil
}
