package transport

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/gen/agent/v1/agentv1connect"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"golang.org/x/sync/errgroup"
)

type peerKey struct{}
type closeBodyKey struct{}
type Peer struct{ ID, Fingerprint string }
type EventSink interface {
	AgentEvent(context.Context, Peer, *agentv1.Event) error
	AgentConnected(context.Context, Peer) error
	AgentDisconnected(context.Context, Peer)
}
type session struct {
	commands chan *agentv1.Command
	cancel   context.CancelFunc
}
type Broker struct {
	mu       sync.Mutex
	sessions map[string]*session
	key      ed25519.PrivateKey
	Sink     EventSink
}

func NewBroker(key ed25519.PrivateKey) *Broker {
	return &Broker{sessions: map[string]*session{}, key: key}
}
func (b *Broker) Send(ctx context.Context, server string, c *agentv1.Command) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	c.Id = security.Token()
	c.ServerId = server
	c.IssuedUnix = time.Now().Unix()
	c.ExpiresUnix = time.Now().Add(30 * time.Second).Unix()
	if e := security.Sign(c, b.key); e != nil {
		return e
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.sessions[server]
	if s == nil {
		return errors.New("agent offline")
	}
	select {
	case s.commands <- c:
		return nil
	default:
		s.cancel()
		return errors.New("agent backpressure")
	}
}
func (b *Broker) Connect(ctx context.Context, stream *connect.BidiStream[agentv1.Event, agentv1.Command]) error {
	peer, ok := ctx.Value(peerKey{}).(Peer)
	if !ok || b.Sink == nil {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("agent identity required"))
	}
	if e := b.Sink.AgentConnected(ctx, peer); e != nil {
		return connect.NewError(connect.CodePermissionDenied, errors.New("agent not enrolled"))
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if closeBody, ok := ctx.Value(closeBodyKey{}).(func()); ok {
		stop := context.AfterFunc(ctx, closeBody)
		defer stop()
	}
	var last atomic.Int64
	last.Store(time.Now().Unix())
	s := &session{make(chan *agentv1.Command, 32), cancel}
	b.mu.Lock()
	if old := b.sessions[peer.ID]; old != nil {
		old.cancel()
	}
	b.sessions[peer.ID] = s
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		current := b.sessions[peer.ID] == s
		if current {
			delete(b.sessions, peer.ID)
		}
		b.mu.Unlock()
		if current {
			c, stop := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			defer stop()
			b.Sink.AgentDisconnected(c, peer)
		}
	}()
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		defer cancel()
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case <-tick.C:
				if time.Now().Unix()-last.Load() > 20 {
					return errors.New("heartbeat timeout")
				}
			}
		}
	})
	g.Go(func() error {
		defer cancel()
		for {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case c := <-s.commands:
				if e := stream.Send(c); e != nil {
					return e
				}
			}
		}
	})
	g.Go(func() error {
		defer cancel()
		for {
			e, err := stream.Receive()
			if err != nil {
				return err
			}
			last.Store(time.Now().Unix())
			if e.ServerId != peer.ID {
				return errors.New("agent identity mismatch")
			}
			if err = b.Sink.AgentEvent(gctx, peer, e); err != nil {
				return err
			}
		}
	})
	// Cancellation closes the request body in Handler, interrupting Receive.
	return g.Wait()
}
func (b *Broker) Handler() (string, http.Handler) {
	path, h := agentv1connect.NewAgentServiceHandler(b, connect.WithReadMaxBytes(1<<20), connect.WithCodec(VTCodec{}))
	return path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "mTLS required", 401)
			return
		}
		c := r.TLS.PeerCertificates[0]
		id := ""
		for _, u := range c.URIs {
			if u.Scheme == "spiffe" && u.Host == "nelcota" && strings.HasPrefix(u.Path, "/agents/") {
				id = strings.TrimPrefix(u.Path, "/agents/")
			}
		}
		if id == "" {
			http.Error(w, "invalid agent identity", 403)
			return
		}
		sum := sha256.Sum256(c.Raw)
		ctx, cancel := context.WithCancel(context.WithValue(r.Context(), peerKey{}, Peer{id, hex.EncodeToString(sum[:])}))
		defer cancel()
		stop := context.AfterFunc(ctx, func() { _ = r.Body.Close() })
		defer stop()
		ctx = context.WithValue(ctx, closeBodyKey{}, func() { _ = r.Body.Close() })
		h.ServeHTTP(w, r.WithContext(ctx))
	})
}

type CommandHandler interface {
	Handle(context.Context, *agentv1.Command, func(*agentv1.Event) error) error
}
type AgentClient struct {
	URL, ServerID string
	TLS           *tls.Config
	Verifier      *security.Verifier
	Handler       CommandHandler
	Metrics       func(context.Context) *agentv1.Metrics
	Active        func() []string
	Observed      func() []*agentv1.ObservedApp
}

func (a *AgentClient) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		started := time.Now()
		e := a.runOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if e == nil || time.Since(started) > time.Minute {
			backoff = time.Second
		}
		timer := time.NewTimer(backoff + time.Duration(rand.IntN(500))*time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}
func (a *AgentClient) runOnce(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	tr := &http.Transport{TLSClientConfig: a.TLS, ForceAttemptHTTP2: true, IdleConnTimeout: 30 * time.Second}
	defer tr.CloseIdleConnections()
	client := agentv1connect.NewAgentServiceClient(&http.Client{Transport: tr}, a.URL, connect.WithReadMaxBytes(1<<20), connect.WithCodec(VTCodec{}))
	stream := client.Connect(ctx)
	stopStream := context.AfterFunc(ctx, func() { _ = stream.CloseRequest(); _ = stream.CloseResponse() })
	defer stopStream()
	defer stream.CloseRequest()
	defer stream.CloseResponse()
	out := make(chan *agentv1.Event, 256)
	emit := func(e *agentv1.Event) error {
		e.ServerId = a.ServerID
		e.TimeUnix = time.Now().Unix()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- e:
			return nil
		default:
			cancel()
			return errors.New("event backpressure")
		}
	}
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		defer cancel()
		heartbeat := time.NewTicker(5 * time.Second)
		metrics := time.NewTicker(15 * time.Second)
		heartbeatCount := 0
		defer heartbeat.Stop()
		defer metrics.Stop()
		if e := stream.Send(&agentv1.Event{ServerId: a.ServerID, TimeUnix: time.Now().Unix(), Payload: &agentv1.Event_Heartbeat{Heartbeat: &agentv1.Heartbeat{RequestState: true}}}); e != nil {
			return e
		}
		for {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case e := <-out:
				if err := stream.Send(e); err != nil {
					return err
				}
			case <-heartbeat.C:
				var active []string
				if a.Active != nil {
					active = a.Active()
				}
				heartbeatCount++
				var observed []*agentv1.ObservedApp
				if a.Observed != nil {
					observed = a.Observed()
				}
				if e := emit(&agentv1.Event{Payload: &agentv1.Event_Heartbeat{Heartbeat: &agentv1.Heartbeat{RequestState: heartbeatCount%2 == 0, ActiveDeploys: active, Apps: observed}}}); e != nil {
					return e
				}
			case <-metrics.C:
				if a.Metrics != nil {
					_ = emit(&agentv1.Event{Payload: &agentv1.Event_Metrics{Metrics: a.Metrics(gctx)}})
				}
			}
		}
	})
	g.Go(func() error {
		defer cancel()
		for {
			c, e := stream.Receive()
			if e != nil {
				if errors.Is(e, io.EOF) {
					return nil
				}
				return e
			}
			if e = a.Verifier.Verify(c, time.Now()); e != nil {
				return e
			}
			if e = a.Handler.Handle(gctx, c, emit); e != nil {
				return e
			}
		}
	})
	return g.Wait()
}

// VTCodec uses generated vtprotobuf methods for the Connect binary codec.
type VTCodec struct{}

func (VTCodec) Name() string { return "proto" }
func (VTCodec) Marshal(v any) ([]byte, error) {
	if m, ok := v.(interface{ MarshalVT() ([]byte, error) }); ok {
		return m.MarshalVT()
	}
	return nil, errors.New("missing vtprotobuf marshaler")
}
func (VTCodec) Unmarshal(b []byte, v any) error {
	if m, ok := v.(interface{ UnmarshalVT([]byte) error }); ok {
		return m.UnmarshalVT(b)
	}
	return errors.New("missing vtprotobuf unmarshaler")
}
