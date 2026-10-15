package events

import (
	"context"
	"go.uber.org/goleak"
	"testing"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
func TestSlowConsumer(t *testing.T) {
	h := NewHub()
	s := h.Subscribe(context.Background(), "logs", 1)
	defer s.Cancel()
	h.Publish("logs", "line", []byte("a"))
	h.Publish("logs", "line", []byte("b"))
	if e := <-s.C; string(e.Data) != "a" {
		t.Fatal(e)
	}
	if _, ok := <-s.C; ok {
		t.Fatal("slow consumer remained connected")
	}
}
func TestRing(t *testing.T) {
	r := NewRing(2)
	r.Append([]byte("1"))
	r.Append([]byte("2"))
	r.Append([]byte("3"))
	s := r.Snapshot()
	if string(s[0]) != "2" || string(s[1]) != "3" {
		t.Fatal(s)
	}
	s[0][0] = 'x'
	if string(r.Snapshot()[0]) != "2" {
		t.Fatal("ring alias")
	}
}
func TestCompressedLog(t *testing.T) {
	l, e := NewLogStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	for _, b := range []string{"hello\n", "world\n"} {
		if e = l.Append(ctx, "deploy", []byte(b)); e != nil {
			t.Fatal(e)
		}
	}
	b, e := l.Read(ctx, "deploy", 100)
	if e != nil || string(b) != "hello\nworld\n" {
		t.Fatal(string(b), e)
	}
	if e = l.Append(ctx, "../escape", nil); e == nil {
		t.Fatal("path traversal")
	}
}
func BenchmarkHub(b *testing.B) {
	h := NewHub()
	for b.Loop() {
		h.Publish("app/a", "status", []byte("ok"))
	}
}
func BenchmarkRing(b *testing.B) {
	r := NewRing(1024)
	line := []byte("building layer 1\n")
	b.ReportAllocs()
	for b.Loop() {
		r.Append(line)
	}
}

func BenchmarkLogStore(b *testing.B) {
	l, e := NewLogStore(b.TempDir())
	if e != nil {
		b.Fatal(e)
	}
	ctx := context.Background()
	line := []byte("[build] dependency cache hit\n")
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if e = l.Append(ctx, "benchmark", line); e != nil {
			b.Fatal(e)
		}
	}
}
