package service

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"github.com/nelcota/nelcota-deploy/internal/provision"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"golang.zx2c4.com/wireguard/wgctrl"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
	"net"
	"time"
)

type PeerConfigurer interface {
	AddPeer(context.Context, string, string) error
}
type WireGuard struct{ Device string }

func (w WireGuard) AddPeer(ctx context.Context, pub, ip string) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	key, e := wgtypes.ParseKey(pub)
	if e != nil {
		return e
	}
	address := net.ParseIP(ip)
	if address == nil {
		return errors.New("invalid peer IP")
	}
	client, e := wgctrl.New()
	if e != nil {
		return e
	}
	defer client.Close()
	return client.ConfigureDevice(w.Device, wgtypes.Config{Peers: []wgtypes.PeerConfig{{PublicKey: key, ReplaceAllowedIPs: true, AllowedIPs: []net.IPNet{{IP: address, Mask: net.CIDRMask(32, 32)}}}}})
}

type JoinInput = provision.JoinInput
type JoinResult = provision.JoinResult
type EnrollmentService struct {
	Core                                                                   *Core
	CA                                                                     *security.Authority
	Peers                                                                  PeerConfigurer
	PanelAddress, PanelEndpoint, PanelWireGuardKey, SigningKey, ControlURL string
}

func (s *EnrollmentService) Join(ctx context.Context, in JoinInput) (JoinResult, error) {
	if len(in.Token) < 32 || len(in.Token) > 128 {
		return JoinResult{}, fail(Unauthenticated, "Convite inválido")
	}
	if _, e := wgtypes.ParseKey(in.WireGuardPublicKey); e != nil {
		return JoinResult{}, fail(Validation, "Chave WireGuard inválida")
	}
	var result JoinResult
	e := s.Core.mutate(ctx, func(tx *sql.Tx) error {
		var id, ip string
		var limit, cache int64
		e := tx.QueryRowContext(ctx, "SELECT s.id,s.wireguard_ip,s.build_limit,s.cache_bytes FROM invitations i JOIN servers s ON s.id=i.server_id WHERE i.token_hash=? AND i.consumed_at=0 AND i.expires_at>?", security.Hash(in.Token), time.Now().Unix()).Scan(&id, &ip, &limit, &cache)
		if e != nil {
			return fail(Unauthenticated, "Convite inválido ou utilizado")
		}
		var duplicates int
		if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM servers WHERE wg_public_key=? AND id<>?", in.WireGuardPublicKey, id).Scan(&duplicates); e != nil {
			return e
		}
		if duplicates != 0 || in.WireGuardPublicKey == s.PanelWireGuardKey {
			return fail(Conflict, "Chave WireGuard já utilizada")
		}
		cert, key, e := s.CA.Issue(id, false, time.Now())
		if e != nil {
			return e
		}
		block, _ := pem.Decode(cert)
		parsed, e := x509.ParseCertificate(block.Bytes)
		if e != nil {
			return e
		}
		fingerprint := sha256.Sum256(parsed.Raw)
		if s.Peers != nil {
			if e = s.Peers.AddPeer(ctx, in.WireGuardPublicKey, ip); e != nil {
				return fail(Unavailable, "Não foi possível configurar WireGuard")
			}
		}
		if _, e = tx.ExecContext(ctx, "UPDATE servers SET fingerprint=?,wg_public_key=?,cert_expires_at=? WHERE id=?", hex.EncodeToString(fingerprint[:]), in.WireGuardPublicKey, parsed.NotAfter.Unix(), id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE invitations SET consumed_at=? WHERE token_hash=? AND consumed_at=0", time.Now().Unix(), security.Hash(in.Token)); e != nil {
			return e
		}
		root, _, e := s.CA.PEM()
		if e != nil {
			return e
		}
		result = JoinResult{ServerID: id, Address: ip, PanelAddress: s.PanelAddress, PanelEndpoint: s.PanelEndpoint, PanelWireGuardKey: s.PanelWireGuardKey, CA: string(root), Certificate: string(cert), PrivateKey: string(key), SigningKey: s.SigningKey, ControlURL: s.ControlURL, BuildLimit: limit, CacheBytes: cache}
		return s.Core.audit(systemContext(ctx), tx, "server.enroll", id)
	})
	return result, e
}

func (s *EnrollmentService) SyncPeers(ctx context.Context) error {
	if s.Peers == nil {
		return nil
	}
	servers, e := s.Core.DB.Queries.ListServers(ctx)
	if e != nil {
		return e
	}
	for _, server := range servers {
		if server.WgPublicKey != "" {
			if e = s.Peers.AddPeer(ctx, server.WgPublicKey, server.WireguardIp); e != nil {
				return e
			}
		}
	}
	return nil
}
