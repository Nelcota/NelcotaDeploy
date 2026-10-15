package events

import (
	"context"
	"sync"
	"time"
)

type Event struct {
	ID    uint64    `json:"id"`
	Topic string    `json:"topic"`
	Kind  string    `json:"kind"`
	Time  time.Time `json:"time"`
	Data  []byte    `json:"data"`
}
type Subscription struct {
	C      <-chan Event
	Cancel func()
}
type Hub struct {
	mu    sync.Mutex
	next  uint64
	subs  map[string]map[uint64]chan Event
	subID uint64
}

func NewHub() *Hub { return &Hub{subs: make(map[string]map[uint64]chan Event)} }
func (h *Hub) Publish(topic, kind string, data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.next++
	e := Event{h.next, topic, kind, time.Now().UTC(), append([]byte(nil), data...)}
	for id, ch := range h.subs[topic] {
		select {
		case ch <- e:
		default:
			close(ch)
			delete(h.subs[topic], id)
		}
	}
}
func (h *Hub) Subscribe(ctx context.Context, topic string, capacity int) Subscription {
	if capacity < 1 {
		capacity = 1
	}
	if capacity > 1024 {
		capacity = 1024
	}
	h.mu.Lock()
	h.subID++
	id := h.subID
	ch := make(chan Event, capacity)
	if h.subs[topic] == nil {
		h.subs[topic] = map[uint64]chan Event{}
	}
	h.subs[topic][id] = ch
	h.mu.Unlock()
	var once sync.Once
	stop := context.AfterFunc(ctx, func() { h.remove(topic, id) })
	return Subscription{ch, func() { once.Do(func() { stop(); h.remove(topic, id) }) }}
}
func (h *Hub) remove(topic string, id uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.subs[topic][id]; ok {
		close(ch)
		delete(h.subs[topic], id)
	}
	if len(h.subs[topic]) == 0 {
		delete(h.subs, topic)
	}
}

type Ring struct {
	mu         sync.Mutex
	lines      [][]byte
	next, size int
	sequence   uint64
}

func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{lines: make([][]byte, capacity)}
}
func (r *Ring) Append(b []byte) uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(b) > 16384 {
		b = b[:16384]
	}
	r.lines[r.next] = append(r.lines[r.next][:0], b...)
	r.next = (r.next + 1) % len(r.lines)
	r.size = min(r.size+1, len(r.lines))
	r.sequence++
	return r.sequence
}
func (r *Ring) Snapshot() [][]byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([][]byte, 0, r.size)
	start := (r.next - r.size + len(r.lines)) % len(r.lines)
	for i := 0; i < r.size; i++ {
		out = append(out, append([]byte(nil), r.lines[(start+i)%len(r.lines)]...))
	}
	return out
}
