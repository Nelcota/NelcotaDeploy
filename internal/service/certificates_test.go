package service

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/transport"
	"testing"
	"time"
)

func TestRenewalRetriesGraceAndFingerprintBinding(t *testing.T) {
	c, ctx, app := fixture(t)
	ca, _ := security.NewAuthority(time.Now().Add(-100 * 24 * time.Hour))
	cert, _, _ := ca.Issue(app.ServerID, false, time.Now().Add(-70*24*time.Hour))
	block, _ := pem.Decode(cert)
	parsed, _ := x509.ParseCertificate(block.Bytes)
	sum := sha256.Sum256(parsed.Raw)
	old := hex.EncodeToString(sum[:])
	if _, e := c.DB.Write.ExecContext(ctx, "UPDATE servers SET fingerprint=?,cert_expires_at=? WHERE id=?", old, parsed.NotAfter.Unix(), app.ServerID); e != nil {
		t.Fatal(e)
	}
	s := &EnrollmentService{Core: c, CA: ca}
	peer := transport.Peer{ID: app.ServerID, Fingerprint: old}
	bundle, e := s.Renew(ctx, peer)
	if e != nil || bundle.Certificate == "" {
		t.Fatal(e)
	}
	retry, e := s.Renew(ctx, peer)
	if e != nil || retry != bundle {
		t.Fatal("lost-response retry changed certificate", e)
	}
	var current string
	var pending []byte
	if e = c.DB.Read.QueryRowContext(ctx, "SELECT fingerprint,pending_certificate FROM servers WHERE id=?", app.ServerID).Scan(&current, &pending); e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(pending, []byte("PRIVATE KEY")) {
		t.Fatal("private certificate stored unencrypted")
	}
	if e = c.AgentConnected(ctx, peer); e != nil {
		t.Fatal("old certificate rejected during grace", e)
	}
	peer.Fingerprint = current
	if e = c.AgentConnected(ctx, peer); e != nil {
		t.Fatal("new certificate rejected", e)
	}
	if b, e := s.Renew(ctx, peer); e != nil || b.Certificate != "" {
		t.Fatal("renewed before due", e)
	}
	peer.Fingerprint = "unregistered"
	if _, e = s.Renew(ctx, peer); !Is(e, Forbidden) {
		t.Fatal(e)
	}
	_, _ = c.DB.Write.ExecContext(ctx, "UPDATE servers SET previous_cert_until=0 WHERE id=?", app.ServerID)
	peer.Fingerprint = old
	if _, e = s.Renew(ctx, peer); !Is(e, Forbidden) {
		t.Fatal("accepted expired grace", e)
	}
	if e = c.AgentConnected(ctx, peer); !Is(e, Forbidden) {
		t.Fatal("connected with expired grace", e)
	}
}
