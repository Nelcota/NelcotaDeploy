package service

import (
	"context"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
	"testing"
	"time"
)

type peerStub struct{ count int }

func (p *peerStub) AddPeer(context.Context, string, string) error { p.count++; return nil }
func TestServerInvitationSingleUse(t *testing.T) {
	c, ctx, _ := fixture(t)
	in, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "new", WireGuardIP: "10.77.0.9"})
	if e != nil {
		t.Fatal(e)
	}
	ca, e := security.NewAuthority(time.Now())
	if e != nil {
		t.Fatal(e)
	}
	peers := &peerStub{}
	s := EnrollmentService{Core: c, CA: ca, Peers: peers}
	private, e := wgtypes.GeneratePrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	join := JoinInput{Token: in.Token, WireGuardPublicKey: private.PublicKey().String()}
	result, e := s.Join(context.Background(), join)
	if e != nil || result.Certificate == "" || result.ServerID != in.ServerID {
		t.Fatal(e)
	}
	if _, e = s.Join(context.Background(), join); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
	if peers.count != 1 {
		t.Fatal(peers.count)
	}
	duplicate, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "duplicate", WireGuardIP: "10.77.0.11"})
	if e != nil {
		t.Fatal(e)
	}
	join.Token = duplicate.Token
	if _, e = s.Join(ctx, join); !Is(e, Conflict) || peers.count != 1 {
		t.Fatal("duplicate key could replace an enrolled WireGuard peer", e, peers.count)
	}
	other, _ := wgtypes.GeneratePrivateKey()
	s.PanelWireGuardKey = other.PublicKey().String()
	join.WireGuardPublicKey = s.PanelWireGuardKey
	if _, e = s.Join(ctx, join); !Is(e, Conflict) || peers.count != 1 {
		t.Fatal("accepted the panel WireGuard identity", e, peers.count)
	}
	join.WireGuardPublicKey = private.PublicKey().String()
	if e = s.SyncPeers(ctx); e != nil || peers.count != 2 {
		t.Fatal("stored WireGuard peers were not restored", peers.count, e)
	}
	expired, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "expired", WireGuardIP: "10.77.0.10"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.DB.Write.ExecContext(ctx, "UPDATE invitations SET expires_at=0 WHERE server_id=?", expired.ServerID); e != nil {
		t.Fatal(e)
	}
	join.Token = expired.Token
	if _, e = s.Join(ctx, join); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
}

func TestServerInvitationCannotPersistLimitsRejectedByAgent(t *testing.T) {
	c, ctx, _ := fixture(t)
	if _, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "invalid", WireGuardIP: "10.77.0.12", CacheBytes: 1}); !Is(e, Validation) {
		t.Fatal("accepted cache ceiling below the snapshot minimum", e)
	}
}
