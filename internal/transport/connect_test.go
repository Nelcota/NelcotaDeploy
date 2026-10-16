package transport

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"go.uber.org/goleak"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

type testSink struct{ b *Broker }

func (s testSink) AgentConnected(context.Context, Peer) error { return nil }
func (s testSink) AgentDisconnected(context.Context, Peer)    {}
func (s testSink) AgentEvent(ctx context.Context, p Peer, e *agentv1.Event) error {
	if e.GetHeartbeat() != nil {
		return s.b.Send(ctx, p.ID, &agentv1.Command{Action: &agentv1.Command_Stats{Stats: &agentv1.Stats{}}})
	}
	return nil
}

type testHandler struct{ received chan struct{} }

func (h testHandler) Handle(_ context.Context, c *agentv1.Command, _ func(*agentv1.Event) error) error {
	if c.GetStats() != nil {
		select {
		case h.received <- struct{}{}:
		default:
		}
	}
	return nil
}
func TestBidirectionalMTLS(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	ca, e := security.NewAuthority(time.Now())
	if e != nil {
		t.Fatal(e)
	}
	root, _, _ := ca.PEM()
	sc, sk, _ := ca.Issue("127.0.0.1", true, time.Now())
	ac, ak, _ := ca.Issue("node", false, time.Now())
	serverTLS, e := security.TLSConfig(sc, sk, root, true)
	if e != nil {
		t.Fatal(e)
	}
	clientTLS, e := security.TLSConfig(ac, ak, root, false)
	if e != nil {
		t.Fatal(e)
	}
	b := NewBroker(key)
	b.Sink = testSink{b}
	_, handler := b.Handler()
	server := httptest.NewUnstartedServer(handler)
	server.EnableHTTP2 = true
	server.TLS = serverTLS
	server.StartTLS()
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	received := make(chan struct{}, 1)
	agent := AgentClient{URL: server.URL, ServerID: "node", TLS: clientTLS, Verifier: &security.Verifier{Key: pub, ServerID: "node"}, Handler: testHandler{received}}
	done := make(chan error, 1)
	go func() { done <- agent.Run(ctx) }()
	select {
	case <-received:
	case <-time.After(5 * time.Second):
		t.Fatal("no signed command received over HTTP/2")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not cancel")
	}
}
