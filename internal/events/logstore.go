package events

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/klauspost/compress/zstd"
)

var logID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

type LogStore struct {
	dir string
	mu  sync.Mutex
}

func NewLogStore(dir string) (*LogStore, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	return &LogStore{dir: dir}, nil
}
func (l *LogStore) path(id string) (string, error) {
	if !logID.MatchString(id) {
		return "", errors.New("invalid log id")
	}
	return filepath.Join(l.dir, id+".zst"), nil
}
func (l *LogStore) Append(ctx context.Context, id string, b []byte) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	p, e := l.path(id)
	if e != nil {
		return e
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, e := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	z, e := zstd.NewWriter(f, zstd.WithEncoderConcurrency(1), zstd.WithEncoderLevel(zstd.SpeedFastest))
	if e != nil {
		return e
	}
	if _, e = z.Write(b); e != nil {
		_ = z.Close()
		return e
	}
	return z.Close()
}
func (l *LogStore) Read(ctx context.Context, id string, maxBytes int64) ([]byte, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	p, e := l.path(id)
	if e != nil {
		return nil, e
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, e := os.Open(p)
	if errors.Is(e, os.ErrNotExist) {
		return []byte{}, nil
	}
	if e != nil {
		return nil, e
	}
	defer f.Close()
	z, e := zstd.NewReader(f, zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxMemory(32<<20))
	if e != nil {
		return nil, e
	}
	defer z.Close()
	return io.ReadAll(io.LimitReader(z, maxBytes))
}
func (l *LogStore) Remove(ctx context.Context, id string) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	p, e := l.path(id)
	if e != nil {
		return e
	}
	e = os.Remove(p)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	return e
}
