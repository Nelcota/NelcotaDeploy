package web

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
)

// liveInterval is how often streams revalidate credentials and send a keepalive,
// matching /api/events.
var liveInterval = 15 * time.Second

// refreshInterval paces optional periodic refreshes of live views.
var refreshInterval = 2 * time.Second

// live serves a Datastar stream for page updates. It subscribes to topics, sends
// a fresh snapshot on every (re)connection, then applies events as they arrive.
// The hub drops slow consumers by closing their channel; the stream then ends and
// Datastar reconnects, which reloads the snapshot. Credentials are rechecked on
// every keepalive so logout or revocation closes the stream.
//
// refresh, when set, runs every refreshInterval for state that is persisted but
// not published as events (such as stage timings of running deployments).
func (h *handler) live(w http.ResponseWriter, r *http.Request, topics []string, snapshot func(*stream) error, on func(*stream, events.Event) error, refresh func(*stream) error) {
	ctx, cancel := context.WithCancel(r.Context())
	var subs []events.Subscription
	var wg sync.WaitGroup
	defer func() {
		cancel()
		for _, sub := range subs {
			sub.Cancel()
		}
		wg.Wait()
	}()
	for _, topic := range topics {
		sub, err := h.s.Logs.Subscribe(ctx, topic)
		if err != nil {
			s := newStream(w, r)
			_ = s.signals(map[string]any{"_conn": "offline"})
			_ = s.toast("danger", publicMessage(err))
			return
		}
		subs = append(subs, sub)
	}
	merged := make(chan events.Event)
	dropped := make(chan struct{})
	var once sync.Once
	for _, sub := range subs {
		wg.Go(func() {
			for {
				select {
				case ev, ok := <-sub.C:
					if !ok {
						once.Do(func() { close(dropped) })
						return
					}
					select {
					case merged <- ev:
					case <-ctx.Done():
						return
					}
				case <-ctx.Done():
					return
				}
			}
		})
	}
	s := newStream(w, r.WithContext(ctx))
	if err := snapshot(s); err != nil {
		_ = s.toast("danger", publicMessage(err))
		return
	}
	if err := s.signals(map[string]any{"_conn": "live"}); err != nil {
		return
	}
	tick := time.NewTicker(liveInterval)
	defer tick.Stop()
	var periodic <-chan time.Time
	if refresh != nil {
		t := time.NewTicker(refreshInterval)
		defer t.Stop()
		periodic = t.C
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-dropped:
			return
		case <-periodic:
			if err := refresh(s); err != nil {
				return
			}
		case <-tick.C:
			if !h.cfg.Authorized(r) {
				_ = s.redirect("/login")
				return
			}
			if s.comment() != nil {
				return
			}
		case ev := <-merged:
			if err := on(s, ev); err != nil {
				return
			}
		}
	}
}
