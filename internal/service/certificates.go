package service

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"time"
)

func (s *EnrollmentService) Renew(ctx context.Context, peer transport.Peer) (security.CertificateBundle, error) {
	var result security.CertificateBundle
	e := s.Core.mutate(ctx, func(tx *sql.Tx) error {
		var current, previous string
		var grace, expires int64
		var pending []byte
		if e := tx.QueryRowContext(ctx, "SELECT fingerprint,previous_fingerprint,previous_cert_until,cert_expires_at,pending_certificate FROM servers WHERE id=?", peer.ID).Scan(&current, &previous, &grace, &expires, &pending); e != nil {
			return fail(Forbidden, "Agent não cadastrado")
		}
		if peer.Fingerprint != current && (peer.Fingerprint != previous || grace < time.Now().Unix()) {
			return fail(Forbidden, "Certificado não cadastrado")
		}
		if peer.Fingerprint == previous && len(pending) > 0 {
			b, e := s.Core.Vault.Open(pending, "certificate:"+peer.ID)
			if e != nil {
				return e
			}
			return json.Unmarshal(b, &result)
		}
		if expires > time.Now().Add(30*24*time.Hour).Unix() {
			return nil
		}
		cert, key, e := s.CA.Issue(peer.ID, false, time.Now())
		if e != nil {
			return e
		}
		block, _ := pem.Decode(cert)
		parsed, e := x509.ParseCertificate(block.Bytes)
		if e != nil {
			return e
		}
		fingerprint := sha256.Sum256(parsed.Raw)
		result = security.CertificateBundle{Certificate: string(cert), PrivateKey: string(key)}
		encoded, e := json.Marshal(result)
		if e != nil {
			return e
		}
		encrypted, e := s.Core.Vault.Seal(encoded, "certificate:"+peer.ID)
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE servers SET previous_fingerprint=fingerprint,previous_cert_until=?,fingerprint=?,cert_expires_at=?,pending_certificate=? WHERE id=?", time.Now().Add(7*24*time.Hour).Unix(), hex.EncodeToString(fingerprint[:]), parsed.NotAfter.Unix(), encrypted, peer.ID); e != nil {
			return e
		}
		return s.Core.audit(systemContext(ctx), tx, "server.certificate.renew", peer.ID)
	})
	return result, e
}
